const {TextSelection, NodeSelection} = require("prosemirror-state")

const browser = require("./browser")
const {selectionCollapsed} = require("./dom")

// Track the state of the current editor selection. Keeps the editor
// selection in sync with the DOM selection by polling for changes,
// as there is no DOM event for DOM selection changes.
class SelectionReader {
  constructor(view) {
    this.view = view

    // Track the state of the DOM selection.
    this.lastAnchorNode = this.lastHeadNode = this.lastAnchorOffset = this.lastHeadOffset = null
    this.lastSelection = view.state.selection
    this.ignoreUpdates = false
    this.poller = poller(this)

    view.dom.addEventListener("focus", () => this.poller.start())
    view.dom.addEventListener("blur", () => this.poller.stop())

    if (!view.editable) this.poller.start()
  }

  destroy() { this.poller.stop() }

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

  // : (?string) → bool
  // When the DOM selection changes in a notable manner, modify the
  // current selection state to match.
  readFromDOM(origin) {
    if (this.ignoreUpdates || !this.domChanged() || !hasFocusAndSelection(this.view)) return
    if (!this.view.inDOMChange) this.view.domObserver.flush()
    if (this.view.inDOMChange) return

    let domSel = this.view.root.getSelection(), doc = this.view.state.doc
    let nearestDesc = this.view.docView.nearestDesc(domSel.focusNode)
    // If the selection is in a non-document part of the view, ignore it
    if (!nearestDesc.size) {
      this.storeDOMState()
      return
    }
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
      let bias = origin == "pointer" || this.view.state.selection.head < $head.pos ? 1 : -1
      selection = selectionBetween(this.view, $anchor, $head, bias)
    }
    if (head == selection.head && $anchor.pos == selection.anchor)
      this.storeDOMState(selection)
    if (!this.view.state.selection.eq(selection)) {
      let tr = this.view.state.tr.setSelection(selection)
      if (origin == "pointer") tr.setMeta("pointer", true)
      this.view.dispatch(tr)
    }
  }
}
exports.SelectionReader = SelectionReader

// There's two polling models. On browsers that support the
// selectionchange event (everything except Firefox, basically), we
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

  start() {
    if (!this.listening) {
      let doc = this.reader.view.dom.ownerDocument
      doc.addEventListener("selectionchange", this.readFunc)
      this.listening = true
      if (hasFocusAndSelection(this.reader.view)) this.readFunc()
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

// On Firefox, we use timeout-based polling.
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

function selectionToDOM(view, takeFocus) {
  let sel = view.state.selection
  syncNodeSelection(view, sel)

  if (!view.hasFocus()) {
    if (!takeFocus) return
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=921444
    if (browser.gecko && view.editable) {
      view.selectionReader.ignoreUpdates = true
      view.dom.focus()
      view.selectionReader.ignoreUpdates = false
    }
  }

  let reader = view.selectionReader
  if (reader.lastSelection && reader.lastSelection.eq(sel) && !reader.domChanged()) return

  reader.ignoreUpdates = true

  if (view.cursorWrapper) {
    selectCursorWrapper(view)
  } else {
    let {anchor, head} = sel, resetEditableFrom, resetEditableTo
    if (browser.webkit && !(sel instanceof TextSelection)) {
      if (!sel.$from.parent.inlineContent)
        resetEditableFrom = temporarilyEditableNear(view, sel.from)
      if (!sel.empty && !sel.$from.parent.inlineContent)
        resetEditableTo = temporarilyEditableNear(view, sel.to)
    }
    view.docView.setSelection(anchor, head, view.root)
    if (browser.webkit) {
      if (resetEditableFrom) resetEditableFrom.contentEditable = "false"
      if (resetEditableTo) resetEditableTo.contentEditable = "false"
    }
    if (sel.visible) {
      view.dom.classList.remove("ProseMirror-hideselection")
    } else {
      view.dom.classList.add("ProseMirror-hideselection")
      if ("onselectionchange" in document) removeClassOnSelectionChange(view)
    }
  }

  reader.storeDOMState(sel)
  reader.ignoreUpdates = false
}
exports.selectionToDOM = selectionToDOM

// Kludge to work around Webkit not allowing a selection to start/end
// between non-editable block nodes. We briefly make something
// editable, set the selection, then set it uneditable again.
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
  let doc = this.reader.view.dom.ownerDocument
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
  let node = view.cursorWrapper.type.widget
  range.setEnd(node, node.childNodes.length)
  range.collapse(false)
  domSel.removeAllRanges()
  domSel.addRange(range)
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

function selectionBetween(view, $anchor, $head, bias) {
  return view.someProp("createSelectionBetween", f => f(view, $anchor, $head))
    || TextSelection.between($anchor, $head, bias)
}
exports.selectionBetween = selectionBetween

function hasFocusAndSelection(view) {
  if (view.editable && view.root.activeElement != view.dom) return false
  let sel = view.root.getSelection()
  return sel.anchorNode && view.dom.contains(sel.anchorNode.nodeType == 3 ? sel.anchorNode.parentNode : sel.anchorNode)
}
