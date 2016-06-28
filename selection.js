const browser = require("../util/browser")
const {Selection, NodeSelection} = require("../selection")

const {posFromDOM, DOMAfterPos, DOMFromPos, coordsAtPos} = require("./dompos")

// Track the state of the current editor selection. Keeps the editor
// selection in sync with the DOM selection by polling for changes,
// as there is no DOM event for DOM selection changes.
class SelectionReader {
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
    if (!this.view.hasFocus() || !this.domChanged()) return

    let domSel = window.getSelection(), doc = this.view.doc
    let $anchor = doc.resolve(posFromDOM(domSel.anchorNode, domSel.anchorOffset))
    let $head = domSel.isCollapsed ? $anchor : doc.resolve(posFromDOM(domSel.focusNode, domSel.focusOffset))
    let bias = this.view.selection.head != null && this.view.selection.head < $head.pos ? 1 : -1
    let selection = Selection.between($anchor, $head, bias)
    if ($head.pos == selection.head && $anchor.pos == selection.anchor)
      this.storeDOMState()
    this.view.channel.selection({selection})
  }

  receivedFocus() {
    if (this.polling == null) this.startPolling()
  }
}
exports.SelectionReader = SelectionReader

function selectionToDOM(view, sel, takeFocus) {
  if (!view.hasFocus()) {
    if (!takeFocus) return
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=921444
    else if (browser.gecko) this.view.content.focus()
  }

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
function textSelectionToDOM(view, sel) {
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

// : (ProseMirror, number, number)
// Whether vertical position motion in a given direction
// from a position would leave a text block.
function verticalMotionLeavesTextblock(view, dir) {
  let $pos = dir < 0 ? view.selection.$from : view.selection.$to
  if (!$pos.depth) return false
  let dom = DOMAfterPos(view, $pos.before())
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
