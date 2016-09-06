const {selFor} = require("prosemirror-state/test/state")
const {EditorView} = require("../src")
const {EditorState} = require("prosemirror-state")
const {schema} = require("prosemirror-model/test/build")

let tempView = null

function tempEditor(inProps) {
  let space = document.querySelector("#workspace")
  if (tempView) {
    space.removeChild(tempView.wrapper)
    tempView = null
  }

  let view, props = {}
  for (let n in inProps) props[n] = inProps[n]
  if (!props.onAction) props.onAction = action => view.updateState(view.state.applyAction(action))
  props.state = EditorState.create({doc: props.doc,
                                    schema,
                                    selection: props.doc && selFor(props.doc),
                                    plugins: props.plugins})
  return view = tempView = new EditorView(space, props)
}
exports.tempEditor = tempEditor

function findTextNode(node, text) {
  if (node.nodeType == 3) {
    if (node.nodeValue == text) return node
  } else if (node.nodeType == 1) {
    for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
      let found = findTextNode(ch, text)
      if (found) return found
    }
  }
}
exports.findTextNode = findTextNode
