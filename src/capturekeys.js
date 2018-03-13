import {Selection, NodeSelection, TextSelection} from "prosemirror-state"
import browser from "./browser"
import {domIndex} from "./dom"

function moveSelectionBlock(state, dir) {
  let {$anchor, $head} = state.selection
  let $side = dir > 0 ? $anchor.max($head) : $anchor.min($head)
  let $start = !$side.parent.inlineContent ? $side : $side.depth ? state.doc.resolve(dir > 0 ? $side.after() : $side.before()) : null
  return $start && Selection.findFrom($start, dir)
}

function apply(view, sel) {
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
  return true
}

function selectHorizontally(view, dir) {
  let sel = view.state.selection
  if (sel instanceof TextSelection) {
    if (!sel.empty) {
      return false
    } else if (view.endOfTextblock(dir > 0 ? "right" : "left")) {
      let next = moveSelectionBlock(view.state, dir)
      if (next && (next instanceof NodeSelection)) return apply(view, next)
      return false
    } else {
      let $head = sel.$head, node = $head.textOffset ? null : dir < 0 ? $head.nodeBefore : $head.nodeAfter, desc
      if (node && NodeSelection.isSelectable(node)) {
        let nodePos = dir < 0 ? $head.pos - node.nodeSize : $head.pos
        if (node.isAtom || (desc = view.docView.descAt(nodePos)) && !desc.contentDOM)
          return apply(view, new NodeSelection(dir < 0 ? view.state.doc.resolve($head.pos - node.nodeSize) : $head))
      }
      return false
    }
  } else if (sel instanceof NodeSelection && sel.node.isInline) {
    return apply(view, new TextSelection(dir > 0 ? sel.$to : sel.$from))
  } else {
    let next = moveSelectionBlock(view.state, dir)
    if (next) return apply(view, next)
    return false
  }
}

function nodeLen(node) {
  return node.nodeType == 3 ? node.nodeValue.length : node.childNodes.length
}

function isIgnorable(dom) {
  let desc = dom.pmViewDesc
  return desc && desc.size == 0 && (dom.nextSibling || dom.nodeName != "BR")
}

// Make sure the cursor isn't directly after one or more ignored
// nodes, which will confuse the browser's cursor motion logic.
function skipIgnoredNodesLeft(view) {
  let sel = view.root.getSelection()
  let node = sel.anchorNode, offset = sel.anchorOffset
  if (!node) return
  let moveNode, moveOffset
  for (;;) {
    if (offset > 0) {
      if (node.nodeType != 1) {
        if (node.nodeType == 3 && node.nodeValue.charAt(offset - 1) == "\ufeff") {
          moveNode = node
          moveOffset = --offset
        } else break
      } else {
        let before = node.childNodes[offset - 1]
        if (isIgnorable(before)) {
          moveNode = node
          moveOffset = --offset
        } else if (before.nodeType == 3) {
          node = before
          offset = node.nodeValue.length
        } else break
      }
    } else if (isBlockNode(node)) {
      break
    } else {
      let prev = node.previousSibling
      while (prev && isIgnorable(prev)) {
        moveNode = node.parentNode
        moveOffset = domIndex(prev)
        prev = prev.previousSibling
      }
      if (!prev) {
        node = node.parentNode
        if (node == view.dom) break
        offset = 0
      } else {
        node = prev
        offset = nodeLen(node)
      }
    }
  }
  if (moveNode) setSel(view, sel, moveNode, moveOffset)
}

// Make sure the cursor isn't directly before one or more ignored
// nodes.
function skipIgnoredNodesRight(view) {
  let sel = view.root.getSelection()
  let node = sel.anchorNode, offset = sel.anchorOffset
  if (!node) return
  let len = nodeLen(node)
  let moveNode, moveOffset
  for (;;) {
    if (offset < len) {
      if (node.nodeType != 1) break
      let after = node.childNodes[offset]
      if (isIgnorable(after)) {
        moveNode = node
        moveOffset = ++offset
      }
      else break
    } else if (isBlockNode(node)) {
      break
    } else {
      let next = node.nextSibling
      while (next && isIgnorable(next)) {
        moveNode = next.parentNode
        moveOffset = domIndex(next) + 1
        next = next.nextSibling
      }
      if (!next) {
        node = node.parentNode
        if (node == view.dom) break
        offset = len = 0
      } else {
        node = next
        offset = 0
        len = nodeLen(node)
      }
    }
  }
  if (moveNode) setSel(view, sel, moveNode, moveOffset)
}

function isBlockNode(dom) {
  let desc = dom.pmViewDesc
  return desc && desc.node && desc.node.isBlock
}

function setSel(view, sel, node, offset) {
  let range = document.createRange()
  range.setEnd(node, offset)
  range.setStart(node, offset)
  sel.removeAllRanges()
  sel.addRange(range)
  view.selectionReader.storeDOMState(view.selection)
}

// : (EditorState, number)
// Check whether vertical selection motion would involve node
// selections. If so, apply it (if not, the result is left to the
// browser)
function selectVertically(view, dir) {
  let sel = view.state.selection
  if (sel instanceof TextSelection && !sel.empty) return false
  let {$from, $to} = sel

  if (!$from.parent.inlineContent || view.endOfTextblock(dir < 0 ? "up" : "down")) {
    let next = moveSelectionBlock(view.state, dir)
    if (next && (next instanceof NodeSelection))
      return apply(view, next)
  }
  if (!$from.parent.inlineContent) {
    let beyond = Selection.findFrom(dir < 0 ? $from : $to, dir)
    return beyond ? apply(view, beyond) : true
  }
  return false
}

function stopNativeHorizontalDelete(view, dir) {
  if (!(view.state.selection instanceof TextSelection)) return true
  let {$head, $anchor, empty} = view.state.selection
  if (!$head.sameParent($anchor)) return true
  if (!empty) return false
  if (view.endOfTextblock(dir > 0 ? "forward" : "backward")) return true
  let nextNode = !$head.textOffset && (dir < 0 ? $head.nodeBefore : $head.nodeAfter)
  if (nextNode && !nextNode.isText) {
    let tr = view.state.tr
    if (dir < 0) tr.delete($head.pos - nextNode.nodeSize, $head.pos)
    else tr.delete($head.pos, $head.pos + nextNode.nodeSize)
    view.dispatch(tr)
    return true
  }
  return false
}

// A backdrop key mapping used to make sure we always suppress keys
// that have a dangerous default effect, even if the commands they are
// bound to return false, and to make sure that cursor-motion keys
// find a cursor (as opposed to a node selection) when pressed. For
// cursor-motion keys, the code in the handlers also takes care of
// block selections.

function getMods(event) {
  let result = ""
  if (event.ctrlKey) result += "c"
  if (event.metaKey) result += "m"
  if (event.altKey) result += "a"
  if (event.shiftKey) result += "s"
  return result
}

export function captureKeyDown(view, event) {
  let code = event.keyCode, mods = getMods(event)
  if (code == 8 || (browser.mac && code == 72 && mods == "c")) { // Backspace, Ctrl-h on Mac
    return stopNativeHorizontalDelete(view, -1) || skipIgnoredNodesLeft(view)
  } else if (code == 46 || (browser.mac && code == 68 && mods == "c")) { // Delete, Ctrl-d on Mac
    return stopNativeHorizontalDelete(view, 1) || skipIgnoredNodesRight(view)
  } else if (code == 13 || code == 27) { // Enter, Esc
    return true
  } else if (code == 37) { // Left arrow
    return selectHorizontally(view, -1) || skipIgnoredNodesLeft(view)
  } else if (code == 39) { // Right arrow
    return selectHorizontally(view, 1) || skipIgnoredNodesRight(view)
  } else if (code == 38) { // Up arrow
    return selectVertically(view, -1) || skipIgnoredNodesLeft(view)
  } else if (code == 40) { // Down arrow
    return selectVertically(view, 1) || skipIgnoredNodesRight(view)
  } else if (mods == (browser.mac ? "m" : "c") &&
             (code == 66 || code == 73 || code == 89 || code == 90)) { // Mod-[biyz]
    return true
  }
  return false
}
