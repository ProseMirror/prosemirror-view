const Keymap = require("browserkeymap")

const {Selection, NodeSelection, TextSelection} = require("../selection")
const browser = require("../util/browser")

const {verticalMotionLeavesTextblock} = require("./selection")

function nothing(view) { return view.state }

function moveSelectionBlock(state, dir) {
  let {$from, $to, node} = state.selection
  let $side = dir > 0 ? $to : $from
  let $start = node && node.isBlock ? $side : $side.depth ? state.doc.resolve(dir > 0 ? $side.after() : $side.before()) : null
  return $start && Selection.findFrom($start, dir)
}

function apply(state, sel) {
  return state.applySelection(sel, {scrollIntoView: true})
}

function selectNodeHorizontally(state, dir) {
  let {empty, node, $from, $to} = state.selection
  if (!empty && !node) return null

  if (node && node.isInline)
    return apply(state, new TextSelection(dir > 0 ? $to : $from))

  if (!node) {
    let {node: nextNode, offset} = dir > 0
        ? $from.parent.childAfter($from.parentOffset)
        : $from.parent.childBefore($from.parentOffset)
    if (nextNode) {
      if (nextNode.type.selectable && offset == $from.parentOffset - (dir > 0 ? 0 : nextNode.nodeSize))
        return apply(state, new NodeSelection(dir < 0 ? state.doc.resolve($from.pos - nextNode.nodeSize) : $from))
      return null
    }
  }

  let next = moveSelectionBlock(state, dir)
  if (next && (next instanceof NodeSelection || node))
    return apply(state, next)
}

function horiz(dir) {
  return view => selectNodeHorizontally(view.state, dir)
}

// : (EditorState, number)
// Check whether vertical selection motion would involve node
// selections. If so, apply it (if not, the result is left to the
// browser)
function selectNodeVertically(view, dir) {
  let {empty, node, $from, $to} = view.state.selection
  if (!empty && !node) return null

  let leavingTextblock = true, $start = dir < 0 ? $from : $to
  if (!node || node.isInline)
    leavingTextblock = verticalMotionLeavesTextblock(view, dir) // FIXME need access to the view

  if (leavingTextblock) {
    let next = moveSelectionBlock(view.state, dir)
    if (next && (next instanceof NodeSelection))
      return apply(view.state, next)
  }

  if (!node || node.isInline) return null

  let beyond = Selection.findFrom($start, dir)
  return beyond ? apply(view.state, beyond) : view.state
}

function vert(dir) {
  return view => selectNodeVertically(view, dir)
}

// A backdrop keymap used to make sure we always suppress keys that
// have a dangerous default effect, even if the commands they are
// bound to return false, and to make sure that cursor-motion keys
// find a cursor (as opposed to a node selection) when pressed. For
// cursor-motion keys, the code in the handlers also takes care of
// block selections.

let keys = {
  "Esc": nothing,
  "Enter": nothing,
  "Ctrl-Enter": nothing,
  "Mod-Enter": nothing,
  "Shift-Enter": nothing,
  "Backspace": browser.ios ? undefined : nothing,
  "Delete": nothing,
  "Mod-B": nothing,
  "Mod-I": nothing,
  "Mod-Backspace": nothing,
  "Mod-Delete": nothing,
  "Shift-Backspace": nothing,
  "Shift-Delete": nothing,
  "Shift-Mod-Backspace": nothing,
  "Shift-Mod-Delete": nothing,
  "Mod-Z": nothing,
  "Mod-Y": nothing,
  "Shift-Mod-Z": nothing,
  "Ctrl-D": nothing,
  "Ctrl-H": nothing,
  "Ctrl-Alt-Backspace": nothing,
  "Alt-D": nothing,
  "Alt-Delete": nothing,
  "Alt-Backspace": nothing,

  "Left": horiz(-1),
  "Mod-Left": horiz(-1),
  "Right": horiz(1),
  "Mod-Right": horiz(1),
  "Up": vert(-1),
  "Down": vert(1)
}

if (browser.mac) {
  keys["Alt-Left"] = horiz(-1)
  keys["Alt-Right"] = horiz(1)
  keys["Ctrl-Backspace"] = keys["Ctrl-Delete"] = nothing
}

const captureKeys = new Keymap(keys)
exports.captureKeys = captureKeys
