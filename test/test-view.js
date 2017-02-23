const {doc, p} = require("prosemirror-model/test/build")
const {EditorState} = require("prosemirror-state")
const {EditorView} = require("../dist")
const {tempEditor} = require("./view")
const ist = require("ist")

let space = document.querySelector("#workspace")

describe("EditorView", () => {
  it("can mount an existing node", () => {
    let dom = space.appendChild(document.createElement("article"))
    let view = new EditorView({mount: dom}, {
      state: EditorState.create({doc: doc(p("hi"))})
    })
    ist(view.dom, dom)
    ist(dom.contentEditable, "true")
    ist(dom.firstChild.nodeName, "P")
    view.destroy()
    ist(dom.contentEditable, "inherit")
    space.removeChild(dom)
  })

  it("reflects the current state in .props", () => {
    let view = tempEditor()
    ist(view.state, view.props.state)
    view.dispatch(view.state.tr.insertText("x"))
    ist(view.state, view.props.state)
  })

  it("can update props with setProp", () => {
    let view = tempEditor({scrollThreshold: 100})
    view.setProps({
      scrollThreshold: null,
      scrollMargin: 10,
      state: view.state.apply(view.state.tr.insertText("y"))
    })
    ist(view.state.doc.content.size, 3)
    ist(view.props.scrollThreshold, null)
    ist(view.props.scrollMargin, 10)
  })
})
