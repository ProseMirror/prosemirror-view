const browser = require("../util/browser")
const {Selection, NodeSelection, TextSelection} = require("../selection")

const {posFromDOM, DOMAfterPos, DOMFromPos, coordsAtPos} = require("./dompos")

// Track the state of the current editor selection. Keeps the editor
// selection in sync with the DOM selection by polling for changes,
// as there is no DOM event for DOM selection changes.
class SelectionReader { // FIXME inline into view
  constructor(view) {
    this.view = view

    // Track the state of the DOM selection.
    this.lastAnchorNode = this.lastHeadNode = this.lastAnchorOffset = this.lastHeadOffset = null

    view.content.addEventListener("focus", () => this.receivedFocus())

    // The timeout ID for the poller when active.
    this.polling = null
    this.poller = this.poller.bind(this)
  }

  poller() {
    if (this.view.hasFocus()) {
      this.readFromDOM()
      this.polling = setTimeout(this.poller, 100)
    } else {
      this.polling = null
    }
  }

  startPolling() {
    clearTimeout(this.polling)
    this.polling = setTimeout(this.poller, 50)
  }

  fastPoll() {
    this.startPolling()
  }

  stopPolling() {
    clearTimeout(this.polling)
    this.polling = null
  }

  // : () → bool
  // Whether the DOM selection has changed from the last known state.
  domChanged() {
    let sel = window.getSelection()
    return sel.anchorNode != this.lastAnchorNode || sel.anchorOffset != this.lastAnchorOffset ||
      sel.focusNode != this.lastHeadNode || sel.focusOffset != this.lastHeadOffset
  }

  // Store the current state of the DOM selection.
  storeDOMState() {
    let sel = window.getSelection()
    this.lastAnchorNode = sel.anchorNode; this.lastAnchorOffset = sel.anchorOffset
    this.lastHeadNode = sel.focusNode; this.lastHeadOffset = sel.focusOffset
  }

  // : () → bool
  // When the DOM selection changes in a notable manner, modify the
  // current selection state to match.
  readFromDOM() {
    if (this.view.hasFocus() && this.domChanged()) {
      let {range, adjusted} = selectionFromDOM(this.view.state.doc, this.view.state.selection.head)
      if (!adjusted) this.storeDOMState()
      this.view.channel(new SelectionChange(range))
    }
  }

  receivedFocus() {
    if (this.polling == null) this.startPolling()
  }
}
exports.SelectionReader = SelectionReader

function selectionToDOM(view, takeFocus) {
  if (!view.hasFocus()) {
    if (!takeFocus) return
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=921444
    else if (browser.gecko) this.pm.content.focus()
  }

  let sel = view.state.selection
  if (sel instanceof NodeSelection)
    nodeSelectionToDOM(view, sel)
  else
    textSelectionToDOM(view, sel)
}
exports.selectionToDOM = selectionToDOM

// Make changes to the DOM for a node selection.
function nodeSelectionToDOM(view, sel) {
  let dom = DOMAfterPos(view, sel.from)
  if (dom != view.lastSelectedNode) {
    clearNodeSelection(view)
    dom.classList.add("ProseMirror-selectednode")
    view.content.classList.add("ProseMirror-nodeselection")
    view.lastSelectedNode = dom
  }
  let range = document.createRange(), domSel = window.getSelection()
  range.selectNode(dom)
  domSel.removeAllRanges()
  domSel.addRange(range)
  view.selectionReader.storeDOMState()
}

// Make changes to the DOM for a text selection.
textSelectionToDOM(view, sel) {
  clearNodeSelection(view)

  let anchor = DOMFromPos(view, sel.anchor)
  let head = DOMFromPos(view, sel.head)

  let domSel = window.getSelection(), range = document.createRange()
  if (domSel.extend) {
    range.setEnd(anchor.node, anchor.offset)
    range.collapse(false)
  } else {
    if (sel.anchor > sel.head) { let tmp = anchor; anchor = head; head = tmp }
    range.setEnd(head.node, head.offset)
    range.setStart(anchor.node, anchor.offset)
  }
  domSel.removeAllRanges()
  domSel.addRange(range)
  if (domSel.extend)
    domSel.extend(head.node, head.offset)
  view.selectionReader.storeDOMState()
}

// Clear all DOM statefulness of the last node selection.
function clearNodeSelection(view) {
  if (view.lastSelectedNode) {
    view.lastSelectedNode.classList.remove("ProseMirror-selectednode")
    view.content.classList.remove("ProseMirror-nodeselection")
    view.lastSelectedNode = null
  }
}

function selectionFromDOM(doc, oldHead) {
  let domSel = window.getSelection()
  let anchor = posFromDOM(domSel.anchorNode, domSel.anchorOffset)
  let head = domSel.isCollapsed ? anchor : posFromDOM(domSel.focusNode, domSel.focusOffset)

  let range = Selection.findNear(doc.resolve(head), oldHead != null && oldHead < head ? 1 : -1)
  if (range instanceof TextSelection) {
    let selNearAnchor = Selection.findFrom(doc.resolve(anchor), anchor > range.to ? -1 : 1, true)
    range = new TextSelection(selNearAnchor.$anchor, range.$head)
  } else if (anchor < range.from || anchor > range.to) {
    // If head falls on a node, but anchor falls outside of it, create
    // a text selection between them
    let inv = anchor > range.to
    let foundAnchor = Selection.findFrom(doc.resolve(anchor), inv ? -1 : 1, true)
    let foundHead = Selection.findFrom(inv ? range.$from : range.$to, inv ? 1 : -1, true)
    if (foundAnchor && foundHead)
      range = new TextSelection(foundAnchor.$anchor, foundHead.$head)
  }
  return {range, adjusted: head != range.head || anchor != range.anchor}
}

// : (ProseMirror, number, number)
// Whether vertical position motion in a given direction
// from a position would leave a text block.
function verticalMotionLeavesTextblock(view, $pos, dir) {
  let dom = $pos.depth ? DOMAfterPos(view, $pos.before()) : pos.content
  let coords = coordsAtPos(view, $pos.pos)
  for (let child = dom.firstChild; child; child = child.nextSibling) {
    if (child.nodeType != 1) continue
    let boxes = child.getClientRects()
    for (let i = 0; i < boxes.length; i++) {
      let box = boxes[i]
      if (dir < 0 ? box.bottom < coords.top : box.top > coords.bottom)
        return false
    }
  }
  return true
}
exports.verticalMotionLeavesTextblock = verticalMotionLeavesTextblock
