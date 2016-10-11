const {doc, p} = require("prosemirror-model/test/build")
const {Plugin} = require("prosemirror-state")
const {tempEditor} = require("./view")
const {DecorationSet, InlineDecoration, WidgetDecoration, NodeDecoration} = require("../dist")
const ist = require("ist")

function make(str) {
  if (typeof str != "string") return str
  let match = /^(\d+)(?:-(\d+))?-(\w+)$/.exec(str)
  if (match[3] == "widget") {
    let widget = document.createElement("button")
    widget.textContent = "ω"
    return WidgetDecoration.create(+match[1], widget)
  }
  return InlineDecoration.create(+match[1], +match[2], {class: match[3]})
}

let id = 0
function decoPlugin(decos) {
  let field = "decos" + ++id

  return new Plugin({
    stateFields: {
      [field]: {
        init(config) { return DecorationSet.create(config.doc, decos.map(make)) },
        applyAction(state, action) {
          let value = state[field]
          if (action.type == "transform" && value)
            return value.map(action.transform.mapping, action.transform.doc)
          if (action.type == "addDecorations")
            return value ? value.add(action.decorations, state.doc) : DecorationSet.create(state.doc, action.decorations)
          return value
        }
      }
    },
    props: {
      decorations(state) { return state[field] }
    }
  })
}

describe("EditorView", () => {
  describe("draw", () => {
    it("draws inline decorations", () => {
      let view = tempEditor({doc: doc(p("foobar")),
                             plugins: [decoPlugin(["2-5-foo"])]})
      let found = view.content.querySelector(".foo")
      ist(found)
      ist(found.textContent, "oob")
    })

    it("draws wrapping decorations", () => {
      let view = tempEditor({doc: doc(p("foo")),
                             plugins: [decoPlugin([InlineDecoration.create(1, 5, {wrapper: document.createElement("i")})])]})
      let found = view.content.querySelector("i")
      ist(found)
      ist(found.getAttribute("pm-offset"), 0)
      ist(found.getAttribute("pm-size"), 3)
      ist(found.innerHTML, "<span>foo</span>")
    })

    it("draws node decorations", () => {
      let view = tempEditor({doc: doc(p("foo"), p("bar")),
                             plugins: [decoPlugin([NodeDecoration.create(5, 10, {class: "cls"})])]})
      let found = view.content.querySelectorAll(".cls")
      ist(found.length, 1)
      ist(found[0].nodeName, "P")
      ist(found[0].previousSibling.nodeName, "P")
    })

    it("draws overlapping inline decorations", () => {
      let view = tempEditor({doc: doc(p("abcdef")),
                             plugins: [decoPlugin(["3-5-foo", "4-6-bar", "1-7-baz"])]})
      let baz = view.content.querySelectorAll(".baz")
      ist(baz.length, 5)
      ist(Array.prototype.map.call(baz, x => x.textContent).join("-"), "ab-c-d-e-f")
      function classes(n) { return n.className.split(" ").sort().join(" ") }
      ist(classes(baz[1]), "baz foo")
      ist(classes(baz[2]), "bar baz foo")
      ist(classes(baz[3]), "bar baz")
    })

    it("draws widgets", () => {
      let view = tempEditor({doc: doc(p("foobar")),
                             plugins: [decoPlugin(["1-widget", "4-widget", "7-widget"])]})
      let found = view.content.querySelectorAll("button")
      ist(found.length, 3)
      ist(found[0].nextSibling.textContent, "foo")
      ist(found[1].nextSibling.textContent, "bar")
      ist(found[2].previousSibling.textContent, "bar")
    })

    it("draws a widget in an empty node", () => {
      let view = tempEditor({doc: doc(p()),
                             plugins: [decoPlugin(["1-widget"])]})
      ist(view.content.querySelector("button"))
    })

    it("supports overlapping inline decorations", () => {
      let view = tempEditor({doc: doc(p("foobar")),
                             plugins: [decoPlugin(["1-3-foo", "2-5-bar"])]})
      let foos = view.content.querySelectorAll(".foo")
      let bars = view.content.querySelectorAll(".bar")
      ist(foos.length, 2)
      ist(bars.length, 2)
      ist(foos[0].textContent, "f")
      ist(foos[1].textContent, "o")
      ist(bars[0].textContent, "o")
      ist(bars[1].textContent, "ob")
    })

    it("doesn't redraw when irrelevant decorations change", () => {
      let view = tempEditor({doc: doc(p("foo"), p("baz")),
                             plugins: [decoPlugin(["7-8-foo"])]})
      let para2 = view.content.lastChild
      view.props.onAction({type: "addDecorations", decorations: [make("2-3-bar")]})
      ist(view.content.lastChild, para2)
      ist(view.content.querySelector(".bar"))
    })

    it("doesn't redraw when irrelevant content changes", () => {
      let view = tempEditor({doc: doc(p("foo"), p("baz")),
                             plugins: [decoPlugin(["7-8-foo"])]})
      let para2 = view.content.lastChild
      view.props.onAction(view.state.tr.delete(2, 3).action())
      view.props.onAction(view.state.tr.delete(2, 3).action())
      ist(view.content.lastChild, para2)
    })

    it("draws a widget added in the middle of a text node", () => {
      let view = tempEditor({doc: doc(p("foo")), plugins: [decoPlugin([])]})
      view.props.onAction({type: "addDecorations", decorations: [make("3-widget")]})
      ist(view.content.firstChild.textContent, "foωo")
    })

    it("can update a text node around a widget", () => {
      let view = tempEditor({doc: doc(p("bar")), plugins: [decoPlugin(["3-widget"])]})
      view.props.onAction(view.state.tr.delete(1, 2).action())
      ist(view.content.querySelectorAll("button").length, 1)
      ist(view.content.firstChild.textContent, "aωr")
    })

    it("can update a text node with an inline decoration", () => {
      let view = tempEditor({doc: doc(p("bar")), plugins: [decoPlugin(["1-3-foo"])]})
      view.props.onAction(view.state.tr.delete(1, 2).action())
      let foo = view.content.querySelector(".foo")
      ist(foo)
      ist(foo.textContent, "a")
      ist(foo.nextSibling.textContent, "r")
    })
  })
})
