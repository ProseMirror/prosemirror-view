const {doc, pre, h1, p} = require("prosemirror-model/test/build")
const {Plugin} = require("prosemirror-state")
const {tempEditor} = require("./view")
const ist = require("ist")

describe("EditorView draw", () => {
  it("updates the DOM", () => {
    let view = tempEditor({doc: doc(p("foo"))})
    view.dispatch(view.state.tr.insertText("bar"))
    ist(view.content.textContent, "barfoo")
  })

  it("doesn't redraw nodes after changes", () => {
    let view = tempEditor({doc: doc(h1("foo<a>"), p("bar"))})
    let oldP = view.content.querySelector("p")
    view.dispatch(view.state.tr.insertText("!"))
    ist(view.content.querySelector("p"), oldP)
  })

  it("doesn't redraw nodes before changes", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"))})
    let oldP = view.content.querySelector("p")
    view.dispatch(view.state.tr.insertText("!", 2))
    ist(view.content.querySelector("p"), oldP)
  })

  it("doesn't redraw nodes between changes", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), pre("baz"))})
    let oldP = view.content.querySelector("p")
    let oldPre = view.content.querySelector("pre")
    view.dispatch(view.state.tr.insertText("!", 2))
    ist(view.content.querySelector("p"), oldP)
    ist(view.content.querySelector("pre"), oldPre)
  })

  it("doesn't redraw siblings of a split node", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), pre("baz"))})
    let oldP = view.content.querySelector("p")
    let oldPre = view.content.querySelector("pre")
    view.dispatch(view.state.tr.split(8))
    ist(view.content.querySelector("p"), oldP)
    ist(view.content.querySelector("pre"), oldPre)
  })

  it("doesn't redraw siblings of a joined node", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), h1("x"), pre("baz"))})
    let oldP = view.content.querySelector("p")
    let oldPre = view.content.querySelector("pre")
    view.dispatch(view.state.tr.join(10))
    ist(view.content.querySelector("p"), oldP)
    ist(view.content.querySelector("pre"), oldPre)
  })

  it("adds classes from the attributes prop", () => {
    let view = tempEditor({doc: doc(p()), attributes: {class: "foo bar"}})
    ist(view.content.classList.contains("foo"))
    ist(view.content.classList.contains("bar"))
    ist(view.content.classList.contains("ProseMirror"))
    view.update({state: view.state, attributes: {class: "baz"}})
    ist(!view.content.classList.contains("foo"))
    ist(view.content.classList.contains("baz"))
  })

  it("can set other attributes", () => {
    let view = tempEditor({doc: doc(p()), attributes: {spellcheck: "false", "aria-label": "hello"}})
    ist(view.content.spellcheck, false)
    ist(view.content.getAttribute("aria-label"), "hello")
    view.update({state: view.state, attributes: {style: "background: yellow"}})
    ist(view.content.hasAttribute("aria-label"), false)
    ist(view.content.style.background, "yellow")
  })

  it("can't set the contenteditable attribute", () => {
    let view = tempEditor({doc: doc(p()), attributes: {contenteditable: "false"}})
    ist(view.content.contentEditable, "true")
  })

  it("understands the editable prop", () => {
    let view = tempEditor({doc: doc(p()), editable: () => false})
    ist(view.content.contentEditable, "false")
    view.update({state: view.state})
    ist(view.content.contentEditable, "true")
  })

  it("doesn't redraw following paragraphs when a paragraph is split", () => {
    let view = tempEditor({doc: doc(p("abcde"), p("fg"))})
    let lastPara = view.content.lastChild
    view.dispatch(view.state.tr.split(3))
    ist(view.content.lastChild, lastPara)
  })

  it("creates and destroys plugin views", () => {
    let events = []
    class PluginView {
      update() { events.push("update") }
      destroy() { events.push("destroy") }
    }
    let plugin = new Plugin({
      view() { events.push("create"); return new PluginView }
    })
    let view = tempEditor({plugins: [plugin]})
    view.dispatch(view.state.tr.insertText("u"))
    view.destroy()
    ist(events.join(" "), "create update destroy")
  })
})
