const {selFor} = require("prosemirror-state/test/state")
const {EditorView} = require("../dist")
const {EditorState} = require("prosemirror-state")
const {schema} = require("prosemirror-test-builder")

let tempView = null

function tempEditor(inProps) {
  let space = document.querySelector("#workspace")
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  let props = {}
  for (let n in inProps) props[n] = inProps[n]
  props.state = EditorState.create({doc: props.doc,
                                    schema,
                                    selection: props.doc && selFor(props.doc),
                                    plugins: props.plugins})
  return tempView = new EditorView(space, props)
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
