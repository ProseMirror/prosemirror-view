const {schema, doc, ul, li, p, strong, hr} = require("prosemirror-test-builder")
const {EditorState} = require("prosemirror-state")
const {Schema} = require("prosemirror-model")
const {EditorView} = require("..")
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

  it("can update with a state using a different schema", () => {
    let testSchema = new Schema({nodes: schema.spec.nodes})
    let view = tempEditor({doc: doc(p(strong("foo")))})
    view.updateState(EditorState.create({doc: testSchema.nodes.doc.createAndFill()}))
    ist(!view.dom.querySelector("strong"))
  })

  it("calls handleScrollToSelection when appropriate", () => {
    let called = 0
    let view = tempEditor({doc: doc(p("foo")),
                           handleScrollToSelection() { called++; return false }})
    view.dispatch(view.state.tr.scrollIntoView())
    ist(called, 1)
  })

  it("can be queried for the DOM position at a doc position", () => {
    let view = tempEditor({doc: doc(ul(li(p(strong("foo")))))})
    let inText = view.domAtPos(4)
    ist(inText.offset, 1)
    ist(inText.node.nodeValue, "foo")
    let beforeLI = view.domAtPos(1)
    ist(beforeLI.offset, 0)
    ist(beforeLI.node.nodeName, "UL")
    let afterP = view.domAtPos(7)
    ist(afterP.offset, 1)
    ist(afterP.node.nodeName, "LI")
  })

  it("can be queried for a node's DOM representation", () => {
    let view = tempEditor({doc: doc(p("foo"), hr)})
    ist(view.nodeDOM(0).nodeName, "P")
    ist(view.nodeDOM(5).nodeName, "HR")
    ist(view.nodeDOM(3), null)
  })

  it("can map DOM positions to doc positions", () => {
    let view = tempEditor({doc: doc(p("foo"), hr)})
    ist(view.posAtDOM(view.dom.firstChild.firstChild, 2), 3)
    ist(view.posAtDOM(view.dom, 1), 5)
    ist(view.posAtDOM(view.dom, 2), 6)
    ist(view.posAtDOM(view.dom.lastChild, 0, -1), 5)
    ist(view.posAtDOM(view.dom.lastChild, 0, 1), 6)
  })

  it("binds this to itself in dispatchTransaction prop", () => {
    const dom = document.createElement("div")
    let thisBinding
    let view = new EditorView(dom, {
      state: EditorState.create({doc: doc(p("hi"))}),
      dispatchTransaction: function() {
        thisBinding = this
      }
    })
    view.dispatch(view.state.tr.insertText("x"))
    ist(view, thisBinding)
  })
})
