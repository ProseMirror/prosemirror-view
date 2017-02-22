const {doc, p} = require("prosemirror-model/test/build")
const {EditorState} = require("prosemirror-state")
const {EditorView} = require("../dist")
const ist = require("ist")

let space = document.querySelector("#workspace")

describe("EditorView", () => {
  it("can mount an existing node", () => {
    let dom = space.appendChild(document.createElement("article"))
    let view = new EditorView({mount: dom}, {
      state: EditorState.create({doc: doc(p("hi"))})
    })
    ist(view.dom, dom)
    ist(view.dom.contentEditable, "true")
    ist(view.dom.firstChild.nodeName, "P")
    view.destroy()
    ist(view.dom.contentEditable, "inherit")
    space.removeChild(dom)
  })
})
