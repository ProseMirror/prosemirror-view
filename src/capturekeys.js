const {Selection, NodeSelection, TextSelection, isSelectable} = require("prosemirror-state")
const browser = require("./browser")

const {verticalMotionLeavesTextblock} = require("./selection")

function moveSelectionBlock(state, dir) {
  let {$from, $to, node} = state.selection
  let $side = dir > 0 ? $to : $from
  let $start = node && node.isBlock ? $side : $side.depth ? state.doc.resolve(dir > 0 ? $side.after() : $side.before()) : null
  return $start && Selection.findFrom($start, dir)
}

function apply(view, sel) {
  view.props.onAction(sel.action({scrollIntoView: true}))
  return true
}

function selectHorizontally(view, dir) {
  let {empty, node, $from, $to} = view.state.selection
  if (!empty && !node) return false

  if (node && node.isInline)
    return apply(view, new TextSelection(dir > 0 ? $to : $from))

  if (!node) {
    let {node: nextNode, offset} = dir > 0
        ? $from.parent.childAfter($from.parentOffset)
        : $from.parent.childBefore($from.parentOffset)
    if (nextNode) {
      if (isSelectable(nextNode) && offset == $from.parentOffset - (dir > 0 ? 0 : nextNode.nodeSize))
        return apply(view, new NodeSelection(dir < 0 ? view.state.doc.resolve($from.pos - nextNode.nodeSize) : $from))
      ;(dir < 0 ? skipIgnoredNodesLeft : skipIgnoredNodesRight)(view)
      return null
    }
  }

  let next = moveSelectionBlock(view.state, dir)
  if (next && (next instanceof NodeSelection || node))
    return apply(view, next)

  return false
}

function nodeLen(node) {
  return node.nodeType == 3 ? node.nodeValue.length : node.childNodes.length
}

// Make sure the cursor isn't directly after one or more ignored
// nodes, which will confuse the browser's cursor motion logic.
function skipIgnoredNodesLeft(view) {
  let sel = view.root.getSelection(), moved = false
  let node = sel.anchorNode, offset = sel.anchorOffset
  for (;;) {
    if (offset > 0) {
      if (node.nodeType != 1) break
      let before = node.childNodes[offset - 1]
      if (before.nodeType == 1 && before.hasAttribute("pm-ignore")) { moved = true; offset-- }
      else break
    } else {
      let prev = node.previousSibling
      while (prev && prev.nodeType == 1 && prev.hasAttribute("pm-ignore")) moved = prev = prev.previousSibling
      if (!prev) {
        node = node.parentNode
        if (node == view.content) break
        offset = 0
      } else {
        node = prev
        offset = nodeLen(node)
      }
    }
  }
  if (moved) setSel(sel, node, offset)
}

// Make sure the cursor isn't directly before one or more ignored
// nodes.
function skipIgnoredNodesRight(view) {
  let sel = view.root.getSelection(), moved = false
  let node = sel.anchorNode, offset = sel.anchorOffset, len = nodeLen(node)
  for (;;) {
    if (offset < len) {
      if (node.nodeType != 1) break
      let after = node.childNodes[offset]
      if (after.nodeType == 1 && after.hasAttribute("pm-ignore")) { moved = true; offset++ }
      else break
    } else {
      let next = node.nextSibling
      while (next && next.nodeType == 1 && next.hasAttribute("pm-ignore")) { moved = next = next.previousSibling }
      if (!next) {
        node = node.parentNode
        if (node == view.content) break
        offset = len = 0
      } else {
        node = next
        offset = 0
        len = nodeLen(node)
      }
    }
  }
  if (moved) setSel(sel, node, offset)
}

function setSel(sel, node, offset) {
  let range = document.createRange()
  range.setEnd(node, offset)
  range.setStart(node, offset)
  sel.removeAllRanges()
  sel.addRange(range)
}

// : (EditorState, number)
// Check whether vertical selection motion would involve node
// selections. If so, apply it (if not, the result is left to the
// browser)
function selectVertically(view, dir) {
  let {empty, node, $from, $to} = view.state.selection
  if (!empty && !node) return false

  let leavingTextblock = true, $start = dir < 0 ? $from : $to
  if (!node || node.isInline)
    leavingTextblock = verticalMotionLeavesTextblock(view, dir) // FIXME need access to the view

  if (leavingTextblock) {
    let next = moveSelectionBlock(view.state, dir)
    if (next && (next instanceof NodeSelection))
      return apply(view, next)
  }

  if (!node || node.isInline) return false

  let beyond = Selection.findFrom($start, dir)
  return beyond ? apply(view, beyond) : true
}

// A backdrop keymap used to make sure we always suppress keys that
// have a dangerous default effect, even if the commands they are
// bound to return false, and to make sure that cursor-motion keys
// find a cursor (as opposed to a node selection) when pressed. For
// cursor-motion keys, the code in the handlers also takes care of
// block selections.

function captureKeyDown(view, event) {
  let code = event.keyCode, mod = browser.mac ? event.metaKey : event.ctrlKey
  if (code == 8) { // Backspace
    return browser.ios ? false : true
  } else if (code == 13 || code == 27 || code == 46) { // Enter, Esc, Delete
    return true
  } else if (mod && !event.altKey && !event.shiftKey &&
             (code == 66 || code == 73 || code == 89 || code == 90 || code == 68 || code == 72)) { // Mod-[BIYZDH]
    return true
  } else if (code == 68 && event.altKey && !mod && !event.shiftKey) { // Alt-D
    return true
  } else if (code == 37) { // Left arrow
    return selectHorizontally(view, -1)
  } else if (code == 39) { // Right arrow
    return selectHorizontally(view, 1)
  } else if (code == 38) { // Up arrow
    return selectVertically(view, -1)
  } else if (code == 40) { // Down arrow
    return selectVertically(view, 1)
  }
}
exports.captureKeyDown = captureKeyDown
