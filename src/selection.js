import {TextSelection, NodeSelection} from "prosemirror-state"

import browser from "./browser"
import {selectionCollapsed} from "./dom"

// Track the state of the DOM selection, creating transactions to
// update the selection state when necessary.
export class SelectionReader {
  constructor(view) {
    this.view = view

    // Track the state of the DOM selection.
    this.lastAnchorNode = this.lastHeadNode = this.lastAnchorOffset = this.lastHeadOffset = null
    this.lastSelection = view.state.selection
    this.ignoreUpdates = false
    this.suppressUpdates = false
    this.poller = poller(this)

    this.focusFunc = (() => this.poller.start(hasFocusAndSelection(this.view))).bind(this)
    this.blurFunc = this.poller.stop

    view.dom.addEventListener("focus", this.focusFunc)
    view.dom.addEventListener("blur", this.blurFunc)

    if (!view.editable) this.poller.start(false)
  }

  destroy() {
    this.view.dom.removeEventListener("focus", this.focusFunc)
    this.view.dom.removeEventListener("blur", this.blurFunc)
    this.poller.stop()
  }

  poll(origin) { this.poller.poll(origin) }

  editableChanged() {
    if (!this.view.editable) this.poller.start()
    else if (!hasFocusAndSelection(this.view)) this.poller.stop()
  }

  // : () → bool
  // Whether the DOM selection has changed from the last known state.
  domChanged() {
    let sel = this.view.root.getSelection()
    return sel.anchorNode != this.lastAnchorNode || sel.anchorOffset != this.lastAnchorOffset ||
      sel.focusNode != this.lastHeadNode || sel.focusOffset != this.lastHeadOffset
  }

  // Store the current state of the DOM selection.
  storeDOMState(selection) {
    let sel = this.view.root.getSelection()
    this.lastAnchorNode = sel.anchorNode; this.lastAnchorOffset = sel.anchorOffset
    this.lastHeadNode = sel.focusNode; this.lastHeadOffset = sel.focusOffset
    this.lastSelection = selection
  }

  clearDOMState() {
    this.lastAnchorNode = this.lastSelection = null
  }

  // : (?string)
  // When the DOM selection changes in a notable manner, modify the
  // current selection state to match.
  readFromDOM(origin) {
    if (this.ignoreUpdates || !this.domChanged() || !hasFocusAndSelection(this.view)) return
    if (this.suppressUpdates) return selectionToDOM(this.view)
    if (!this.view.inDOMChange) this.view.domObserver.flush()
    if (this.view.inDOMChange) return

    let domSel = this.view.root.getSelection(), doc = this.view.state.doc
    let nearestDesc = this.view.docView.nearestDesc(domSel.focusNode), inWidget = nearestDesc && nearestDesc.size == 0
    let head = this.view.docView.posFromDOM(domSel.focusNode, domSel.focusOffset)
    let $head = doc.resolve(head), $anchor, selection
    if (selectionCollapsed(domSel)) {
      $anchor = $head
      while (nearestDesc && !nearestDesc.node) nearestDesc = nearestDesc.parent
      if (nearestDesc && nearestDesc.node.isAtom && NodeSelection.isSelectable(nearestDesc.node) && nearestDesc.parent) {
        let pos = nearestDesc.posBefore
        selection = new NodeSelection(head == pos ? $head : doc.resolve(pos))
      }
    } else {
      $anchor = doc.resolve(this.view.docView.posFromDOM(domSel.anchorNode, domSel.anchorOffset))
    }

    if (!selection) {
      let bias = origin == "pointer" || (this.view.state.selection.head < $head.pos && !inWidget) ? 1 : -1
      selection = selectionBetween(this.view, $anchor, $head, bias)
    }
    if (!this.view.state.selection.eq(selection)) {
      let tr = this.view.state.tr.setSelection(selection)
      if (origin == "pointer") tr.setMeta("pointer", true)
      else if (origin == "key") tr.scrollIntoView()
      this.view.dispatch(tr)
    } else {
      selectionToDOM(this.view)
    }
  }
}

// There's two polling models. On browsers that support the
// selectionchange event (everything except Firefox < 52, basically), we
// register a listener for that whenever the editor is focused.
class SelectionChangePoller {
  constructor(reader) {
    this.listening = false
    this.curOrigin = null
    this.originTime = 0
    this.reader = reader

    this.readFunc = () => reader.readFromDOM(this.originTime > Date.now() - 50 ? this.curOrigin : null)
  }

  poll(origin) {
    this.curOrigin = origin
    this.originTime = Date.now()
  }

  start(andRead) {
    if (!this.listening) {
      let doc = this.reader.view.dom.ownerDocument
      doc.addEventListener("selectionchange", this.readFunc)
      this.listening = true
      if (andRead) this.readFunc()
    }
  }

  stop() {
    if (this.listening) {
      let doc = this.reader.view.dom.ownerDocument
      doc.removeEventListener("selectionchange", this.readFunc)
      this.listening = false
    }
  }
}

// On Browsers that don't support the selectionchange event,
// we use timeout-based polling.
class TimeoutPoller {
  constructor(reader) {
    // The timeout ID for the poller when active.
    this.polling = null
    this.reader = reader
    this.pollFunc = this.doPoll.bind(this, null)
  }

  doPoll(origin) {
    let view = this.reader.view
    if (view.focused || !view.editable) {
      this.reader.readFromDOM(origin)
      this.polling = setTimeout(this.pollFunc, 100)
    } else {
      this.polling = null
    }
  }

  poll(origin) {
    clearTimeout(this.polling)
    this.polling = setTimeout(origin ? this.doPoll.bind(this, origin) : this.pollFunc, 0)
  }

  start() {
    if (this.polling == null) this.poll()
  }

  stop() {
    clearTimeout(this.polling)
    this.polling = null
  }
}

function poller(reader) {
  return new ("onselectionchange" in document ? SelectionChangePoller : TimeoutPoller)(reader)
}

export function selectionToDOM(view, takeFocus, force) {
  let sel = view.state.selection
  syncNodeSelection(view, sel)

  if (view.editable && !view.hasFocus()) {
    if (!takeFocus) return
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=921444
    if (browser.gecko && browser.gecko_version <= 55) {
      view.selectionReader.ignoreUpdates = true
      view.dom.focus()
      view.selectionReader.ignoreUpdates = false
    }
  } else if (!view.editable && !hasSelection(view) && !takeFocus) {
    return
  }

  let reader = view.selectionReader
  if (reader.lastSelection && reader.lastSelection.eq(sel) && !reader.domChanged()) return

  reader.ignoreUpdates = true

  if (view.cursorWrapper) {
    selectCursorWrapper(view)
  } else {
    let {anchor, head} = sel, resetEditableFrom, resetEditableTo
    if (brokenSelectBetweenUneditable && !(sel instanceof TextSelection)) {
      if (!sel.$from.parent.inlineContent)
        resetEditableFrom = temporarilyEditableNear(view, sel.from)
      if (!sel.empty && !sel.$from.parent.inlineContent)
        resetEditableTo = temporarilyEditableNear(view, sel.to)
    }
    view.docView.setSelection(anchor, head, view.root, force)
    if (brokenSelectBetweenUneditable) {
      if (resetEditableFrom) resetEditableFrom.contentEditable = "false"
      if (resetEditableTo) resetEditableTo.contentEditable = "false"
    }
    if (sel.visible) {
      view.dom.classList.remove("ProseMirror-hideselection")
    } else if (anchor != head) {
      view.dom.classList.add("ProseMirror-hideselection")
      if ("onselectionchange" in document) removeClassOnSelectionChange(view)
    }
  }

  reader.storeDOMState(sel)
  reader.ignoreUpdates = false
}

// Kludge to work around Webkit not allowing a selection to start/end
// between non-editable block nodes. We briefly make something
// editable, set the selection, then set it uneditable again.

const brokenSelectBetweenUneditable = browser.safari || browser.chrome && browser.chrome_version < 63

function temporarilyEditableNear(view, pos) {
  let {node, offset} = view.docView.domFromPos(pos)
  let after = offset < node.childNodes.length ? node.childNodes[offset] : null
  let before = offset ? node.childNodes[offset - 1] : null
  if ((!after || after.contentEditable == "false") && (!before || before.contentEditable == "false")) {
    if (after) {
      after.contentEditable = "true"
      return after
    } else if (before) {
      before.contentEditable = "true"
      return before
    }
  }
}

function removeClassOnSelectionChange(view) {
  let doc = view.dom.ownerDocument
  doc.removeEventListener("selectionchange", view.hideSelectionGuard)
  let domSel = view.root.getSelection()
  let node = domSel.anchorNode, offset = domSel.anchorOffset
  doc.addEventListener("selectionchange", view.hideSelectionGuard = () => {
    if (domSel.anchorNode != node || domSel.anchorOffset != offset) {
      doc.removeEventListener("selectionchange", view.hideSelectionGuard)
      view.dom.classList.remove("ProseMirror-hideselection")
    }
  })
}

function selectCursorWrapper(view) {
  let domSel = view.root.getSelection(), range = document.createRange()
  let node = view.cursorWrapper.dom
  range.setEnd(node, node.childNodes.length)
  range.collapse(false)
  domSel.removeAllRanges()
  domSel.addRange(range)
  // Kludge to kill 'control selection' in IE11 when selecting an
  // invisible cursor wrapper, since that would result in those weird
  // resize handles and a selection that considers the absolutely
  // positioned wrapper, rather than the root editable node, the
  // focused element.
  if (!view.state.selection.visible && browser.ie && browser.ie_version <= 11) {
    node.disabled = true
    node.disabled = false
  }
}

function syncNodeSelection(view, sel) {
  if (sel instanceof NodeSelection) {
    let desc = view.docView.descAt(sel.from)
    if (desc != view.lastSelectedViewDesc) {
      clearNodeSelection(view)
      if (desc) desc.selectNode()
      view.lastSelectedViewDesc = desc
    }
  } else {
    clearNodeSelection(view)
  }
}

// Clear all DOM statefulness of the last node selection.
function clearNodeSelection(view) {
  if (view.lastSelectedViewDesc) {
    view.lastSelectedViewDesc.deselectNode()
    view.lastSelectedViewDesc = null
  }
}

export function selectionBetween(view, $anchor, $head, bias) {
  return view.someProp("createSelectionBetween", f => f(view, $anchor, $head))
    || TextSelection.between($anchor, $head, bias)
}

function hasFocusAndSelection(view) {
  if (view.editable && view.root.activeElement != view.dom) return false
  return hasSelection(view)
}

function hasSelection(view) {
  let sel = view.root.getSelection()
  if (!sel.anchorNode) return false
  try {
    // Firefox will raise 'permission denied' errors when accessing
    // properties of `sel.anchorNode` when it's in a generated CSS
    // element.
    return view.dom.contains(sel.anchorNode.nodeType == 3 ? sel.anchorNode.parentNode : sel.anchorNode) &&
      (view.editable || view.dom.contains(sel.focusNode.nodeType == 3 ? sel.focusNode.parentNode : sel.focusNode))
  } catch(_) {
    return false
  }
}

function nonInclusiveMark(mark) {
  return mark.type.spec.inclusive === false
}

export function needsCursorWrapper(state) {
  let {$head, $anchor, visible} = state.selection
  let $pos = $head.pos == $anchor.pos && (!visible || $head.parent.inlineContent) ? $head : null
  if ($pos && (!visible || state.storedMarks || $pos.parent.content.length == 0 ||
               $pos.parentOffset && !$pos.textOffset && $pos.nodeBefore.marks.some(nonInclusiveMark)))
    return $pos
  else
    return null
}
