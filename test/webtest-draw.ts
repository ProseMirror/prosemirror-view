import {doc, strong, pre, h1, p, hr, schema} from "prosemirror-test-builder"
import {Plugin} from "prosemirror-state"
import {Schema} from "prosemirror-model"
import ist from "ist"
import {tempEditor} from "./view"

describe("EditorView draw", () => {
  it("updates the DOM", () => {
    let view = tempEditor({doc: doc(p("foo"))})
    view.dispatch(view.state.tr.insertText("bar"))
    ist(view.dom.textContent, "barfoo")
  })

  it("doesn't redraw nodes after changes", () => {
    let view = tempEditor({doc: doc(h1("foo<a>"), p("bar"))})
    let oldP = view.dom.querySelector("p")
    view.dispatch(view.state.tr.insertText("!"))
    ist(view.dom.querySelector("p"), oldP)
  })

  it("doesn't redraw nodes before changes", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"))})
    let oldP = view.dom.querySelector("p")
    view.dispatch(view.state.tr.insertText("!", 2))
    ist(view.dom.querySelector("p"), oldP)
  })

  it("doesn't redraw nodes between changes", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), pre("baz"))})
    let oldP = view.dom.querySelector("p")
    let oldPre = view.dom.querySelector("pre")
    view.dispatch(view.state.tr.insertText("!", 2))
    ist(view.dom.querySelector("p"), oldP)
    ist(view.dom.querySelector("pre"), oldPre)
  })

  it("doesn't redraw siblings of a split node", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), pre("baz"))})
    let oldP = view.dom.querySelector("p")
    let oldPre = view.dom.querySelector("pre")
    view.dispatch(view.state.tr.split(8))
    ist(view.dom.querySelector("p"), oldP)
    ist(view.dom.querySelector("pre"), oldPre)
  })

  it("doesn't redraw siblings of a joined node", () => {
    let view = tempEditor({doc: doc(p("foo"), h1("bar"), h1("x"), pre("baz"))})
    let oldP = view.dom.querySelector("p")
    let oldPre = view.dom.querySelector("pre")
    view.dispatch(view.state.tr.join(10))
    ist(view.dom.querySelector("p"), oldP)
    ist(view.dom.querySelector("pre"), oldPre)
  })

  it("doesn't redraw after a big deletion", () => {
    let view = tempEditor({doc: doc(p(), p(), p(), p(), p(), p(), p(), p(), h1("!"), p(), p())})
    let oldH = view.dom.querySelector("h1")
    view.dispatch(view.state.tr.delete(2, 14))
    ist(view.dom.querySelector("h1"), oldH)
  })

  it("adds classes from the attributes prop", () => {
    let view = tempEditor({doc: doc(p()), attributes: {class: "foo bar"}})
    ist(view.dom.classList.contains("foo"))
    ist(view.dom.classList.contains("bar"))
    ist(view.dom.classList.contains("ProseMirror"))
    view.update({state: view.state, attributes: {class: "baz"}})
    ist(!view.dom.classList.contains("foo"))
    ist(view.dom.classList.contains("baz"))
  })

  it("adds style from the attributes prop", () => {
    let view = tempEditor({doc: doc(p()), attributes: {style: "border: 1px solid red;"}, plugins: [new Plugin({props: { attributes: {style: "background: red;"}}}), new Plugin({props: { attributes: {style: "color: red;"}}})]})
    ist(view.dom.style.border, "1px solid red")
    ist(view.dom.style.backgroundColor, "red")
    ist(view.dom.style.color, "red")
  })

  it("can set other attributes", () => {
    let view = tempEditor({doc: doc(p()), attributes: {spellcheck: "false", "aria-label": "hello"}})
    ist(view.dom.spellcheck, false)
    ist(view.dom.getAttribute("aria-label"), "hello")
    view.update({state: view.state, attributes: {style: "background-color: yellow"}})
    ist(view.dom.hasAttribute("aria-label"), false)
    ist(view.dom.style.backgroundColor, "yellow")
  })

  it("can't set the contenteditable attribute", () => {
    let view = tempEditor({doc: doc(p()), attributes: {contenteditable: "false"}})
    ist(view.dom.contentEditable, "true")
  })

  it("understands the editable prop", () => {
    let view = tempEditor({doc: doc(p()), editable: () => false})
    ist(view.dom.contentEditable, "false")
    view.update({state: view.state})
    ist(view.dom.contentEditable, "true")
  })

  it("doesn't redraw following paragraphs when a paragraph is split", () => {
    let view = tempEditor({doc: doc(p("abcde"), p("fg"))})
    let lastPara = view.dom.lastChild
    view.dispatch(view.state.tr.split(3))
    ist(view.dom.lastChild, lastPara)
  })

  it("doesn't greedily match nodes that have another match", () => {
    let view = tempEditor({doc: doc(p("a"), p("b"), p())})
    let secondPara = view.dom.querySelectorAll("p")[1]
    view.dispatch(view.state.tr.split(2))
    ist(view.dom.querySelectorAll("p")[2], secondPara)
  })

  it("creates and destroys plugin views", () => {
    let events: string[] = []
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

  it("redraws changed node views", () => {
    let view = tempEditor({doc: doc(p("foo"), hr())})
    ist(view.dom.querySelector("hr"))
    view.setProps({nodeViews: {horizontal_rule: () => {
      return {dom: document.createElement("var")}
    }}})
    ist(!view.dom.querySelector("hr"))
    ist(view.dom.querySelector("var"))
  })

  it("doesn't get confused by merged nodes", () => {
    let view = tempEditor({doc: doc(p(strong("one"), " two ", strong("three")))})
    view.dispatch(view.state.tr.removeMark(1, 4, schema.marks.strong))
    ist(view.dom.querySelectorAll("strong").length, 1)
  })

  it("doesn't redraw too much when marks are present", () => {
    let s = new Schema({
      nodes: {
        doc: {content: "paragraph+", marks: "m"},
        text: {group: "inline"},
        paragraph: schema.spec.nodes.get("paragraph")!
      },
      marks: {
        m: {
          toDOM: () => ["div", {class: "m"}, 0],
          parseDOM: [{tag: "div.m"}]
        }
      }
    })
    let paragraphs = []
    for (let i = 1; i <= 10; i++)
      paragraphs.push(s.node("paragraph", null, [s.text("para " + i)], [s.mark("m")]))
    let view = tempEditor({
      doc: s.node("doc", null, paragraphs),
    })
    let initialChildren = Array.from(view.dom.querySelectorAll("p"))
    let newParagraphs = []
    for (let i = -6; i < 0; i++)
      newParagraphs.push(s.node("paragraph", null, [s.text("para " + i)], [s.mark("m")]))
    view.dispatch(view.state.tr.replaceWith(0, 8, newParagraphs))
    let currentChildren = Array.from(view.dom.querySelectorAll("p")), sameAtEnd = 0
    while (sameAtEnd < currentChildren.length && sameAtEnd < initialChildren.length &&
           currentChildren[currentChildren.length - sameAtEnd - 1] == initialChildren[initialChildren.length - sameAtEnd - 1])
      sameAtEnd++
    ist(sameAtEnd, 9)
  })
})
