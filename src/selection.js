const {Selection, NodeSelection} = require("prosemirror-state")

const browser = require("./browser")

// Track the state of the current editor selection. Keeps the editor
// selection in sync with the DOM selection by polling for changes,
// as there is no DOM event for DOM selection changes.
class SelectionReader {
  constructor(view) {
    this.view = view

    // Track the state of the DOM selection.
    this.lastAnchorNode = this.lastHeadNode = this.lastAnchorOffset = this.lastHeadOffset = null
    this.lastSelection = view.state.selection
    this.poller = poller(this)

    view.content.addEventListener("focus", () => this.poller.start())
    view.content.addEventListener("blur", () => this.poller.stop())

    if (!view.editable) this.poller.start()
  }

  destroy() { this.poller.stop() }

  poll(origin) { this.poller.poll(origin) }

  editableChanged() {
    if (!this.view.editable) this.poller.start()
    else if (!this.view.hasFocus()) this.poller.stop()
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

  // : (?string) → bool
  // When the DOM selection changes in a notable manner, modify the
  // current selection state to match.
  readFromDOM(origin) {
    if (!this.view.hasFocus() || this.view.inDOMChange || !this.domChanged()) return

    let domSel = this.view.root.getSelection(), doc = this.view.state.doc
    let domNode = domSel.focusNode, head = this.view.docView.posFromDOM(domNode, domSel.focusOffset)
    let $head = doc.resolve(head), $anchor, selection
    if (domSel.isCollapsed) {
      $anchor = $head
      let nearestDesc = this.view.docView.nearestDesc(domNode)
      while (nearestDesc && !nearestDesc.node) nearestDesc = nearestDesc.parent
      if (nearestDesc && nearestDesc.node.isLeaf && NodeSelection.isSelectable(nearestDesc.node))
        selection = new NodeSelection($head)
    } else {
      $anchor = doc.resolve(this.view.docView.posFromDOM(domSel.anchorNode, domSel.anchorOffset))
    }

    if (!selection) {
      let bias = this.view.state.selection.head != null && this.view.state.selection.head < $head.pos ? 1 : -1
      selection = Selection.between($anchor, $head, bias)
    }
    if ($head.pos == selection.head && $anchor.pos == selection.anchor)
      this.storeDOMState(selection)
    this.view.props.onAction(selection.action(origin && {origin}))
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

    this.readFunc = () => reader.readFromDOM(this.originTime > Date.now() - 50 ? this.curOrigin : null)
  }

  poll(origin) {
    this.curOrigin = origin
    this.originTime = Date.now()
  }

  start() {
    if (!this.listening) {
      document.addEventListener("selectionchange", this.readFunc)
      this.listening = true
    }
  }

  stop() {
    if (this.listening) {
      document.removeEventListener("selectionchange", this.readFunc)
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

function selectionToDOM(view, sel, takeFocus) {
  syncNodeSelection(view, sel)

  if (!view.hasFocus()) {
    if (!takeFocus) return
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=921444
    else if (browser.gecko && view.editable) view.content.focus()
  }

  let reader = view.selectionReader
  if (sel.eq(reader.lastSelection) && !reader.domChanged()) return
  if (sel.node)
    view.root.getSelection().removeAllRanges()
  else
    view.docView.setSelection(sel.anchor, sel.head, view.root)
  reader.storeDOMState(sel)
}
exports.selectionToDOM = selectionToDOM

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
