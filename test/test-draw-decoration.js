const {doc, pre, h1, p} = require("prosemirror-model/test/build")
const {Plugin} = require("prosemirror-state")
const {tempEditor} = require("./view")
const {DecorationSet, InlineDecoration, WidgetDecoration} = require("../dist")
const ist = require("ist")

function make(str) {
  let match = /^(\d+)(?:-(\d+))?-(\w+)$/.exec(str)
  if (match[3] == "widget") return WidgetDecoration.create(+match[1], document.createElement("button"))
  else return InlineDecoration.create(+match[1], +match[2], {class: match[3]})
}

let id = 0
function decoPlugin(decos) {
  let field = "decos" + ++id

  return new Plugin({
    stateFields: {
      [field]: {
        init(config) { return DecorationSet.create(config.doc, decos.map(make)) },
        applyAction(state, action) {
          if (action.type == "transform")
            return state[field].map(action.transform.mapping, action.transform.doc)
          if (action.type == "addDecoration")
            return state[field].addDecoration(action.decoration, state.doc)
          return state[field]
        }
      }
    },
    props: {
      decorations(state) { return state[field] }
    }
  })
}

function widget() {
  return document.createElement("button")
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

    it("draws widgets", () => {
      let view = tempEditor({doc: doc(p("foobar")),
                             plugins: [decoPlugin(["1-widget", "4-widget", "7-widget"])]})
      let found = view.content.querySelectorAll("button")
      ist(found.length, 3)
      ist(found[0].nextSibling.textContent, "foo")
      ist(found[1].nextSibling.textContent, "bar")
      ist(found[2].previousSibling.textContent, "bar")
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
      view.props.onAction({type: "addDecoration", decoration: make("2-3-bar")})
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
  })
})
