const ist = require("ist")
const {schema, doc, p, blockquote} = require("prosemirror-model/test/build")
const {Transform} = require("prosemirror-transform")

const {WidgetDecoration, InlineDecoration, DecorationSet, removeOverlap} = require("../dist/decoration")

let widget = document.createElement("button")

function make(d) {
  if (d.pos != null) return WidgetDecoration.create(d.pos, d.widget || widget)
  else return InlineDecoration.create(d.from, d.to, d.attrs || {}, d)
}

function build(doc, ...decorations) {
  return DecorationSet.create(doc, decorations.map(make))
}

function str(set) {
  let s = "[" + set.local.map(d => d.from + "-" + d.to).join(", ")
  for (let i = 0; i < set.children.length; i += 3)
    s += (s.length > 1 ? ", " : "") + set.children[i] + ": " + str(set.children[i + 2])
  return s + "]"
}

function buildMap(doc, ...decorations) {
  let f = decorations.pop()
  let oldSet = build(doc, ...decorations)
  let tr = f(new Transform(doc))
  return {set: oldSet.map(tr.mapping, tr.doc), oldSet}
}

function buildAdd(doc, ...decorations) {
  let toAdd = make(decorations.pop())
  return build(doc, ...decorations).addDecoration(toAdd, doc)
}

describe("DecorationSet", () => {
  it("builds up a matching tree", () => {
    let set = build(doc(p("foo"), blockquote(p("bar"))), {from: 2, to: 3}, {from: 8, to: 9})
    ist(str(set), "[0: [1-2], 5: [0: [1-2]]]")
  })

  it("does not build nodes when there are no decorations", () => {
    let set = build(doc(p("foo"), blockquote(p("bar"))), {from: 8, to: 9})
    ist(str(set), "[5: [0: [1-2]]]")
  })

  it("puts decorations between children in local", () => {
    let set = build(doc(p("a"), p("b")), {pos: 3})
    ist(str(set), "[3-3]")
  })

  it("puts decorations spanning children in local", () => {
    let set = build(doc(p("a"), p("b")), {from: 1, to: 5})
    ist(str(set), "[1-5]")
  })

  it("supports basic mapping", () => {
    let {oldSet, set} = buildMap(doc(p("foo"), p("bar")),
                                 {from: 2, to: 3}, {from: 7, to: 8},
                                 tr => tr.replaceWith(4, 4, schema.text("!!")))
    ist(str(oldSet), "[0: [1-2], 5: [1-2]]")
    ist(str(set), "[0: [1-2], 7: [1-2]]")
  })

  it("drops deleted decorations", () => {
    let {set} = buildMap(doc(p("foobar")), {from: 2, to: 3}, tr => tr.delete(1, 4))
    ist(str(set), "[]")
  })

  it("isn't inclusive by default", () => {
    let {set} = buildMap(doc(p("foo")), {from: 2, to: 3},
                         tr => tr.replaceWith(2, 2, schema.text(".")).replaceWith(4, 4, schema.text("?")))
    ist(str(set), "[0: [2-3]]")
  })

  it("understands unclusiveLeft", () => {
    let {set} = buildMap(doc(p("foo")), {from: 2, to: 3, inclusiveLeft: true},
                         tr => tr.replaceWith(2, 2, schema.text(".")).replaceWith(4, 4, schema.text("?")))
    ist(str(set), "[0: [1-3]]")
  })

  it("understands unclusiveRight", () => {
    let {set} = buildMap(doc(p("foo")), {from: 2, to: 3, inclusiveRight: true},
                         tr => tr.replaceWith(2, 2, schema.text(".")).replaceWith(4, 4, schema.text("?")))
    ist(str(set), "[0: [2-4]]")
  })

  it("preserves subtrees not touched by mapping", () => {
    let {oldSet, set} = buildMap(doc(p("foo"), blockquote(p("bar"), p("baz"))),
                                 {from: 2, to: 3}, {from: 8, to: 9}, {from: 13, to: 14},
                                 tr => tr.delete(8, 9))
    ist(str(set), "[0: [1-2], 5: [4: [1-2]]]")
    ist(set.children[2], oldSet.children[2]) // FIXME sane accessors?
    ist(set.children[5].children[2], oldSet.children[5].children[5])
  })

  it("rebuilds when a node is joined", () => {
    let {set} = buildMap(doc(p("foo"), p("bar")),
                         {from: 2, to: 3}, {from: 7, to: 8},
                         tr => tr.join(5))
    ist(str(set), "[0: [1-2, 4-5]]")
  })

  it("rebuilds when a node is split", () => {
    let {set} = buildMap(doc(p("foobar")), {from: 2, to: 3}, {from: 5, to: 6}, tr => tr.split(4))
    ist(str(set), "[0: [1-2], 5: [1-2]]")
  })

  it("correctly rebuilds a deep structure", () => {
    let {oldSet, set} = buildMap(doc(blockquote(p("foo")), blockquote(blockquote(p("bar")))),
                                 {from: 3, to: 4}, {from: 11, to: 12},
                                 tr => tr.join(7))
    ist(str(oldSet), "[0: [0: [1-2]], 7: [0: [0: [1-2]]]]")
    ist(str(set), "[0: [0: [1-2], 5: [0: [1-2]]]]")
  })

  it("can add a local decoration", () => {
    ist(str(buildAdd(doc(p("foo"), p("bar")), {pos: 0}, {pos: 5})),
        "[0-0, 5-5]")
  })

  it("can add a decoration in a new child", () => {
    ist(str(buildAdd(doc(p("foo"), p("bar")), {pos: 0}, {pos: 3})),
        "[0-0, 0: [2-2]]")
  })

  it("can add a decoration to an existing child", () => {
    ist(str(buildAdd(doc(p("foo"), p("bar")), {pos: 1}, {pos: 3})),
        "[0: [0-0, 2-2]]")
  })

  it("can add a decoration beyond an existing child", () => {
    ist(str(buildAdd(doc(blockquote(p("foo"))), {pos: 1}, {pos: 4})),
        "[0: [0-0, 0: [2-2]]]")
  })
})

function arrayStr(arr) {
  return arr.map(d => d.from + "-" + d.to).join(", ")
}

describe("removeOverlap", () => {
  it("returns the original array when there is no overlap", () => {
    let decs = [WidgetDecoration.create(1, widget), InlineDecoration.create(1, 4, {}), InlineDecoration.create(1, 4, {})]
    ist(removeOverlap(decs), decs)
  })

  it("splits a partially overlapping decoration", () => {
    let decs = [InlineDecoration.create(1, 2, {}), InlineDecoration.create(1, 4, {}), InlineDecoration.create(3, 4, {})]
    ist(arrayStr(removeOverlap(decs)), "1-2, 1-2, 2-3, 3-4, 3-4")
  })

  it("splits a decoration that spans multiple others", () => {
    let decs = [InlineDecoration.create(1, 5, {}), WidgetDecoration.create(2, widget), WidgetDecoration.create(3, widget)]
    ist(arrayStr(removeOverlap(decs)), "1-2, 2-2, 2-3, 3-3, 3-5")
  })
})
