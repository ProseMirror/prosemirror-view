const {EditorView} = require("..")
const {EditorState, Selection, TextSelection, NodeSelection} = require("prosemirror-state")
const {schema} = require("prosemirror-test-builder")

function selFor(doc) {
  let a = doc.tag.a
  if (a != null) {
    let $a = doc.resolve(a)
    if ($a.parent.inlineContent) return new TextSelection($a, doc.tag.b != null ? doc.resolve(doc.tag.b) : undefined)
    else return new NodeSelection($a)
  }
  return Selection.atStart(doc)
}

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

function requireFocus(pm) {
  if (!document.hasFocus())
    throw new Error("The document doesn't have focus, which is needed for this test")
  pm.focus()
  return pm
}
exports.requireFocus = requireFocus
