const {doc, p, hr, em, blockquote} = require("prosemirror-test-builder")
const {Plugin} = require("prosemirror-state")
const {tempEditor} = require("./view")
const {DecorationSet, Decoration} = require("../dist")
const ist = require("ist")

function make(str) {
  if (typeof str != "string") return str
  let match = /^(\d+)(?:-(\d+))?-(.+)$/.exec(str)
  if (match[3] == "widget") {
    let widget = document.createElement("button")
    widget.textContent = "ω"
    return Decoration.widget(+match[1], widget)
  }
  return Decoration.inline(+match[1], +match[2], {class: match[3]})
}

function decoPlugin(decos) {
  return new Plugin({
    state: {
      init(config) { return DecorationSet.create(config.doc, decos.map(make)) },
      apply(tr, set, state) {
        if (tr.docChanged) set = set.map(tr.mapping, tr.doc)
        let change = tr.getMeta("updateDecorations")
        if (change) {
          if (change.remove) set = set.remove(change.remove)
          if (change.add) set = set.add(state.doc, change.add)
        }
        return set
      }
    },
    props: {
      decorations(state) { return this.getState(state) }
    }
  })
}

function updateDeco(view, add, remove) {
  view.dispatch(view.state.tr.setMeta("updateDecorations", {add, remove}))
}

describe("Decoration drawing", () => {
  it("draws inline decorations", () => {
    let view = tempEditor({doc: doc(p("foobar")),
                           plugins: [decoPlugin(["2-5-foo"])]})
    let found = view.dom.querySelector(".foo")
    ist(found)
    ist(found.textContent, "oob")
  })

  it("draws wrapping decorations", () => {
    let view = tempEditor({doc: doc(p("foo")),
                           plugins: [decoPlugin([Decoration.inline(1, 5, {nodeName: "i"})])]})
    let found = view.dom.querySelector("i")
    ist(found && found.innerHTML, "foo")
  })

  it("draws node decorations", () => {
    let view = tempEditor({doc: doc(p("foo"), p("bar")),
                           plugins: [decoPlugin([Decoration.node(5, 10, {class: "cls"})])]})
    let found = view.dom.querySelectorAll(".cls")
    ist(found.length, 1)
    ist(found[0].nodeName, "P")
    ist(found[0].previousSibling.nodeName, "P")
  })

  it("draws overlapping inline decorations", () => {
    let view = tempEditor({doc: doc(p("abcdef")),
                           plugins: [decoPlugin(["3-5-foo", "4-6-bar", "1-7-baz"])]})
    let baz = view.dom.querySelectorAll(".baz")
    ist(baz.length, 5)
    ist(Array.prototype.map.call(baz, x => x.textContent).join("-"), "ab-c-d-e-f")
    function classes(n) { return n.className.split(" ").sort().join(" ") }
    ist(classes(baz[1]), "baz foo")
    ist(classes(baz[2]), "bar baz foo")
    ist(classes(baz[3]), "bar baz")
  })

  it("draws multiple widgets", () => {
    let view = tempEditor({doc: doc(p("foobar")),
                           plugins: [decoPlugin(["1-widget", "4-widget", "7-widget"])]})
    let found = view.dom.querySelectorAll("button")
    ist(found.length, 3)
    ist(found[0].nextSibling.textContent, "foo")
    ist(found[1].nextSibling.textContent, "bar")
    ist(found[2].previousSibling.textContent, "bar")
  })

  it("orders widgets by their side option", () => {
    let view = tempEditor({doc: doc(p("foobar")),
                           plugins: [decoPlugin([Decoration.widget(4, document.createTextNode("B")),
                                                 Decoration.widget(4, document.createTextNode("A"), {side: -100}),
                                                 Decoration.widget(4, document.createTextNode("C"), {side: 2})])]})
    ist(view.dom.textContent, "fooABCbar")
  })

  it("draws a widget in an empty node", () => {
    let view = tempEditor({doc: doc(p()),
                           plugins: [decoPlugin(["1-widget"])]})
    ist(view.dom.querySelectorAll("button").length, 1)
  })

  it("draws widgets on node boundaries", () => {
    let view = tempEditor({doc: doc(p("foo", em("bar"))),
                           plugins: [decoPlugin(["4-widget"])]})
    ist(view.dom.querySelectorAll("button").length, 1)
  })

  it("draws decorations from multiple plugins", () => {
    let view = tempEditor({doc: doc(p("foo", em("bar"))),
                           plugins: [decoPlugin(["2-widget"]), decoPlugin(["6-widget"])]})
    ist(view.dom.querySelectorAll("button").length, 2)
  })

  it("draws inline decorations spanning multiple parents", () => {
    let view = tempEditor({doc: doc(p("long first ", em("p"), "aragraph"), p("two")),
                           plugins: [decoPlugin(["7-25-foo"])]})
    let foos = view.dom.querySelectorAll(".foo")
    ist(foos.length, 4)
    ist(foos[0].textContent, "irst ")
    ist(foos[1].textContent, "p")
    ist(foos[2].textContent, "aragraph")
    ist(foos[3].textContent, "tw")
  })

  it("draws inline decorations across empty paragraphs", () => {
    let view = tempEditor({doc: doc(p("first"), p(), p("second")),
                           plugins: [decoPlugin(["3-12-foo"])]})
    let foos = view.dom.querySelectorAll(".foo")
    ist(foos.length, 2)
    ist(foos[0].textContent, "rst")
    ist(foos[1].textContent, "se")
  })

  it("can handle inline decorations ending at the start or end of a node", () => {
    let view = tempEditor({doc: doc(p(), p()),
                           plugins: [decoPlugin(["1-3-foo"])]})
    ist(!view.dom.querySelector(".foo"))
  })

  it("can draw decorations with multiple classes", () => {
    let view = tempEditor({doc: doc(p("foo")),
                           plugins: [decoPlugin(["1-4-foo bar"])]})
    ist(view.dom.querySelectorAll(".foo").length, 1)
    ist(view.dom.querySelectorAll(".bar").length, 1)
  })

  it("supports overlapping inline decorations", () => {
    let view = tempEditor({doc: doc(p("foobar")),
                           plugins: [decoPlugin(["1-3-foo", "2-5-bar"])]})
    let foos = view.dom.querySelectorAll(".foo")
    let bars = view.dom.querySelectorAll(".bar")
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
    let para2 = view.dom.lastChild
    updateDeco(view, [make("2-3-bar")])
    ist(view.dom.lastChild, para2)
    ist(view.dom.querySelector(".bar"))
  })

  it("doesn't redraw when irrelevant content changes", () => {
    let view = tempEditor({doc: doc(p("foo"), p("baz")),
                           plugins: [decoPlugin(["7-8-foo"])]})
    let para2 = view.dom.lastChild
    view.dispatch(view.state.tr.delete(2, 3))
    view.dispatch(view.state.tr.delete(2, 3))
    ist(view.dom.lastChild, para2)
  })

  it("can add a widget on a node boundary", () => {
    let view = tempEditor({doc: doc(p("foo", em("bar"))),
                           plugins: [decoPlugin([])]})
    updateDeco(view, [make("4-widget")])
    ist(view.dom.querySelectorAll("button").length, 1)
  })

  it("can remove a widget on a node boundary", () => {
    let dec = make("4-widget")
    let view = tempEditor({doc: doc(p("foo", em("bar"))),
                           plugins: [decoPlugin([dec])]})
    updateDeco(view, null, [dec])
    ist(view.dom.querySelector("button"), null)
  })

  it("can remove the class from a text node", () => {
    let dec = make("1-4-foo")
    let view = tempEditor({doc: doc(p("abc")),
                           plugins: [decoPlugin([dec])]})
    ist(view.dom.querySelector(".foo"))
    updateDeco(view, null, [dec])
    ist(view.dom.querySelector(".foo"), null)
  })

  it("can remove the class from part of a text node", () => {
    let dec = make("2-4-foo")
    let view = tempEditor({doc: doc(p("abcd")),
                           plugins: [decoPlugin([dec])]})
    ist(view.dom.querySelector(".foo"))
    updateDeco(view, null, [dec])
    ist(view.dom.querySelector(".foo"), null)
    ist(view.dom.firstChild.innerHTML, "abcd")
  })

  it("can remove the class for part of a text node", () => {
    let dec = make("2-4-foo")
    let view = tempEditor({doc: doc(p("abcd")),
                           plugins: [decoPlugin([dec])]})
    ist(view.dom.querySelector(".foo"))
    updateDeco(view, [make("2-4-bar")], [dec])
    ist(view.dom.querySelector(".foo"), null)
    ist(view.dom.querySelector(".bar"))
  })

  it("draws a widget added in the middle of a text node", () => {
    let view = tempEditor({doc: doc(p("foo")), plugins: [decoPlugin([])]})
    updateDeco(view, [make("3-widget")])
    ist(view.dom.firstChild.textContent, "foωo")
  })

  it("can update a text node around a widget", () => {
    let view = tempEditor({doc: doc(p("bar")), plugins: [decoPlugin(["3-widget"])]})
    view.dispatch(view.state.tr.delete(1, 2))
    ist(view.dom.querySelectorAll("button").length, 1)
    ist(view.dom.firstChild.textContent, "aωr")
  })

  it("can update a text node with an inline decoration", () => {
    let view = tempEditor({doc: doc(p("bar")), plugins: [decoPlugin(["1-3-foo"])]})
    view.dispatch(view.state.tr.delete(1, 2))
    let foo = view.dom.querySelector(".foo")
    ist(foo)
    ist(foo.textContent, "a")
    ist(foo.nextSibling.textContent, "r")
  })

  it("correctly redraws a partially decorated node when a widget is added", () => {
    let view = tempEditor({doc: doc(p("one", em("two"))),
                           plugins: [decoPlugin(["1-6-foo"])]})
    updateDeco(view, [make("6-widget")])
    let foos = view.dom.querySelectorAll(".foo")
    ist(foos.length, 2)
    ist(foos[0].textContent, "one")
    ist(foos[1].textContent, "tw")
  })

  it("correctly redraws when skipping split text node", () => {
    let view = tempEditor({doc: doc(p("foo")),
                           plugins: [decoPlugin(["3-widget", "3-4-foo"])]})
    updateDeco(view, [make("4-widget")])
    ist(view.dom.querySelectorAll("button").length, 2)
  })

  it("drops removed node decorations from the view", () => {
    let deco = Decoration.node(1, 6, {class: "cls"})
    let view = tempEditor({doc: doc(blockquote(p("foo"), p("bar"))),
                           plugins: [decoPlugin([deco])]})
    updateDeco(view, null, [deco])
    ist(!view.dom.querySelector(".cls"))
  })

  it("can update a node's attributes without replacing the node", () => {
    let deco = Decoration.node(0, 5, {title: "title", class: "foo"})
    let view = tempEditor({doc: doc(p("foo")),
                           plugins: [decoPlugin([deco])]})
    let para = view.dom.querySelector("p")
    updateDeco(view, [Decoration.node(0, 5, {class: "foo bar"})], [deco])
    ist(view.dom.querySelector("p"), para)
    ist(para.className, "foo bar")
    ist(!para.title)
  })

  it("passes decorations to a node view", () => {
    let current = ""
    let view = tempEditor({
      doc: doc(p("foo"), hr),
      plugins: [decoPlugin([])],
      nodeViews: {horizontal_rule: () => ({
        update(_, decos) {
          current = decos.map(d => d.spec.name).join()
        }
      })}
    })
    let a = Decoration.node(5, 6, {}, {name: "a"})
    updateDeco(view, [a], [])
    ist(current, "a")
    updateDeco(view, [Decoration.node(5, 6, {}, {name: "b"}),
                      Decoration.node(5, 6, {}, {name: "c"})], [a])
    ist(current, "b,c")
  })
})
