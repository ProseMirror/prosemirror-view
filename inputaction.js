const Keymap = require("browserkeymap")
const {Selection, NodeSelection, TextSelection} = require("../selection")

const {captureKeys} = require("./capturekeys")

const handled = {}

exports.inputAction = {
  selection(view, {selection}) {
    sendSelection(view, selection)
    return handled
  },

  key(view, {keyName}) {
    let keymaps = view.props.keymaps || []
    for (let i = 0; i <= keymaps.length; i++) {
      let map = i == keymaps.length ? captureKeys : keymaps[i].map
      let bound = map.lookup(keyName, view), action

      if (bound === false) {
        return null
      } else if (bound == Keymap.unfinished) {
        return {prefix: keyName}
      } else if (action = bound && bound(map == captureKeys ? view : view.state)) {
        if (action !== true) view.props.onAction(action)
        return handled
      }
    }
  },

  insertText(view, {from, to, text, newSelection}) {
    if (from == null) {
      ;({from, to} = view.selection)
    }
    if (view.props.handleTextInput && view.props.handleTextInput.call(view, from, to, text))
      return handled

    let marks = view.state.view.storedMarks || view.state.doc.marksAt(from)
    let tr = view.state.tr.replaceWith(from, to, text ? view.state.schema.text(text, marks) : null)
    tr.setSelection(newSelection
                    ? Selection.between(tr.doc.resolve(newSelection.anchor), tr.doc.resolve(newSelection.head))
                    : Selection.near(tr.doc.resolve(tr.mapping.map(to)), -1))
    view.props.onAction(tr.action(true))
    return handled
  },

  cut(view, {from, to}) {
    view.props.onAction(view.state.tr.delete(from, to).action(true))
    return handled
  },

  paste(view, data) {
    return doReplace(view, data)
  },

  drop(view, data) {
    return doReplace(view, data, true)
  },

  replace(view, data) {
    return doReplace(view, data)
  },

  singleClick(view, {pos, inside, ctrl}) {
    if (ctrl) {
      if (selectClickedNode(view, pos, inside)) return handled
      else return null
    }

    if (runHandlerOnContext(view, view.props.handleClickOn, pos, inside) ||
        (view.props.handleClick && view.props.handleClick.call(view, pos)) ||
        inside != null && selectClickedLeaf(view, inside))
      return handled
  },

  doubleClick(view, {pos, inside}) {
    if (runHandlerOnContext(view, view.props.handleDoubleClickOn, pos, inside) ||
        (view.props.handleDoubleClick && view.props.handleDoubleClick.call(view, pos)))
      return handled
  },

  tripleClick(view, {pos, inside}) {
    if (runHandlerOnContext(view, view.props.handleTripleClickOn, pos, inside) ||
        (view.props.handleTripleClick && view.props.handleTripleClick.call(view, pos)) ||
        handleTripleClick(view, pos, inside))
      return handled

  },

  contextMenu(view, {pos}) {
    if (view.props.handleContextMenu && view.props.handleContextMenu.call(view, pos))
      return handled
  },

  forceUpdate(view) {
    view.props.onAction({type: "update"})
  }
}

function doReplace(view, {from, to, slice, newSelection}, selectContent) {
  if (view.props.transformPasted) slice = view.props.transformPasted(slice)
  let tr = view.state.tr.replace(from, to, slice)
  if (selectContent)
    tr.setSelection(Selection.between(tr.doc.resolve(from), tr.doc.resolve(tr.mapping.map(to))))
  else
    tr.setSelection(newSelection
                    ? Selection.between(tr.doc.resolve(newSelection.anchor), tr.doc.resolve(newSelection.head))
                    : Selection.near(tr.doc.resolve(tr.mapping.map(to)), -1))
  view.props.onAction(tr.action(true))
  return handled
}

function sendSelection(view, selection) {
  view.props.onAction({type: "selection", selection, focus: true})
}

function selectClickedNode(view, pos, inside) {
  let {node: selectedNode, $from} = view.selection, selectAt

  let $pos = view.state.doc.resolve(inside == null ? pos : inside)
  for (let i = $pos.depth + (inside == null ? 0 : 1); i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (node.type.selectable) {
      if (selectedNode && $from.depth > 0 &&
          i >= $from.depth && $pos.before($from.depth + 1) == $from.pos)
        selectAt = $pos.before($from.depth)
      else
        selectAt = $pos.before(i)
      break
    }
  }

  if (selectAt != null) {
    sendSelection(view, new NodeSelection(view.state.doc.resolve(selectAt)))
    return true
  } else {
    return false
  }
}

function selectClickedLeaf(view, inside) {
  let leaf = view.state.doc.nodeAt(inside)
  if (leaf && leaf.type.isLeaf && leaf.type.selectable) {
    sendSelection(view, new NodeSelection(view.state.doc.resolve(inside)))
    return true
  }
}

function runHandlerOnContext(view, handler, pos, inside) {
  if (!handler) return
  let $pos = view.state.doc.resolve(inside == null ? pos : inside)
  for (let i = $pos.depth + (inside == null ? 0 : 1); i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (handler.call(view, pos, node, $pos.before(i))) return true
  }
}

function handleTripleClick(view, pos, inside) {
  let doc = view.state.doc, $pos = doc.resolve(inside == null ? pos : inside)
  for (let i = $pos.depth + (inside == null ? 0 : 1); i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    let nodePos = $pos.before(i)
    if (node.isTextblock)
      sendSelection(view, new TextSelection(doc.resolve(nodePos + 1),
                                            doc.resolve(nodePos + 1 + node.content.size)))
    else if (node.type.selectable)
      sendSelection(view, new NodeSelection(doc.resolve(nodePos)))
    else
      continue
    return true
  }
}
