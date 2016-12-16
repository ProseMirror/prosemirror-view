const {doc, pre, h1, p} = require("prosemirror-model/test/build")
const {tempEditor} = require("./view")
const ist = require("ist")

function apply(view, tr) {
  view.props.onAction(tr.action())
}

describe("EditorView edraw", () => {
  it("updates the DOM", () => {
    let view = tempEditor({doc: doc(p("foo"))})
    apply(view, view.state.tr.insertText("bar"))
    ist(view.content.textContent, "barfoo")
  })

  it("doesn't redraw nodes after changes", () => {
    let view = tempEditor({doc: doc(h1("foo<a>"), p("bar"))})
    let oldP = view.content.querySelector("p")
    apply(view, view.state.tr.insertText("!"))
    ist(view.content.querySelector("p"), oldP)
  })

  it("doesn't redraw nodes before changes", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"))})
    let oldP = view.content.querySelector("p")
    apply(view, view.state.tr.insertText("!", 2))
    ist(view.content.querySelector("p"), oldP)
  })

  it("doesn't redraw nodes between changes", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), pre("baz"))})
    let oldP = view.content.querySelector("p")
    let oldPre = view.content.querySelector("pre")
    apply(view, view.state.tr.insertText("!", 2))
    ist(view.content.querySelector("p"), oldP)
    ist(view.content.querySelector("pre"), oldPre)
  })

  it("doesn't redraw siblings of a split node", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), pre("baz"))})
    let oldP = view.content.querySelector("p")
    let oldPre = view.content.querySelector("pre")
    apply(view, view.state.tr.split(8))
    ist(view.content.querySelector("p"), oldP)
    ist(view.content.querySelector("pre"), oldPre)
  })

  it("doesn't redraw siblings of a joined node", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), h1("x"), pre("baz"))})
    let oldP = view.content.querySelector("p")
    let oldPre = view.content.querySelector("pre")
    apply(view, view.state.tr.join(10))
    ist(view.content.querySelector("p"), oldP)
    ist(view.content.querySelector("pre"), oldPre)
  })
})
