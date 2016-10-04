const ist = require("ist")
const {schema, doc, p, blockquote} = require("prosemirror-model/test/build")
const {Transform} = require("prosemirror-transform")

const { Decoration, DecorationSet } = require("../dist/decoration")

function build(doc, ...decorations) {
  return DecorationSet.create(doc, decorations.map(d => new Decoration(d.start, d.end, d)))
}

function buildMap(doc, ...decorations) {
  let f = decorations.pop()
  let oldSet = build(doc, ...decorations)
  let tr = f(new Transform(doc))
  return {set: oldSet.map(tr.mapping, tr.doc), oldSet}
}

describe("DecorationSet", () => {
  it("builds up a matching tree", () => {
    let set = build(doc(p("foo"), blockquote(p("bar"))), {start: 2, end: 3}, {start: 8, end: 9})
    ist(set.toString(), "[0: [1-2], 5: [0: [1-2]]]")
  })

  it("does not build nodes when there are no decorations", () => {
    let set = build(doc(p("foo"), blockquote(p("bar"))), {start: 8, end: 9})
    ist(set.toString(), "[5: [0: [1-2]]]")
  })

  it("puts decorations between children in local", () => {
    let set = build(doc(p("a"), p("b")), {start: 3, end: 3})
    ist(set.toString(), "[3-3]")
  })

  it("puts decorations spanning children in local", () => {
    let set = build(doc(p("a"), p("b")), {start: 1, end: 5})
    ist(set.toString(), "[1-5]")
  })

  it("supports basic mapping", () => {
    let {oldSet, set} = buildMap(doc(p("foo"), p("bar")),
                                 {start: 2, end: 3}, {start: 7, end: 8},
                                 tr => tr.replaceWith(4, 4, schema.text("!!")))
    ist(oldSet.toString(), "[0: [1-2], 5: [1-2]]")
    ist(set.toString(), "[0: [1-2], 7: [1-2]]")
  })

  it("drops deleted decorations", () => {
    let {set} = buildMap(doc(p("foobar")), {start: 2, end: 3}, tr => tr.delete(1, 4))
    ist(set.toString(), "[]")
  })

  it("preserves persistent decorations", () => {
    let {set} = buildMap(doc(p("foobar")), {start: 2, end: 3, persistent: true}, tr => tr.delete(1, 4))
    ist(set.toString(), "[0: [0-0]]")
  })

  it("isn't inclusive by default", () => {
    let {set} = buildMap(doc(p("foo")), {start: 2, end: 3},
                         tr => tr.replaceWith(2, 2, schema.text(".")).replaceWith(4, 4, schema.text("?")))
    ist(set.toString(), "[0: [2-3]]")
  })

  it("understands unclusiveLeft", () => {
    let {set} = buildMap(doc(p("foo")), {start: 2, end: 3, inclusiveLeft: true},
                         tr => tr.replaceWith(2, 2, schema.text(".")).replaceWith(4, 4, schema.text("?")))
    ist(set.toString(), "[0: [1-3]]")
  })

  it("understands unclusiveRight", () => {
    let {set} = buildMap(doc(p("foo")), {start: 2, end: 3, inclusiveRight: true},
                         tr => tr.replaceWith(2, 2, schema.text(".")).replaceWith(4, 4, schema.text("?")))
    ist(set.toString(), "[0: [2-4]]")
  })

  it("preserves subtrees not touched by mapping", () => {
    let {oldSet, set} = buildMap(doc(p("foo"), blockquote(p("bar"), p("baz"))),
                                 {start: 2, end: 3}, {start: 8, end: 9}, {start: 13, end: 14},
                                 tr => tr.delete(8, 9))
    ist(set.toString(), "[0: [1-2], 5: [4: [1-2]]]")
    ist(set.children[2], oldSet.children[2]) // FIXME sane accessors?
    ist(set.children[5].children[2], oldSet.children[5].children[5])
  })

  it("rebuilds when a node is joined", () => {
    let {set} = buildMap(doc(p("foo"), p("bar")),
                         {start: 2, end: 3}, {start: 7, end: 8},
                         tr => tr.join(5))
    ist(set.toString(), "[0: [1-2, 4-5]]")
  })

  it("rebuilds when a node is split", () => {
    let {set} = buildMap(doc(p("foobar")), {start: 2, end: 3}, {start: 5, end: 6}, tr => tr.split(4))
    ist(set.toString(), "[0: [1-2], 5: [1-2]]")
  })

  it("correctly rebuilds a deep structure", () => {
    let {oldSet, set} = buildMap(doc(blockquote(p("foo")), blockquote(blockquote(p("bar")))),
                                 {start: 3, end: 4}, {start: 11, end: 12},
                                 tr => tr.join(7))
    ist(oldSet.toString(), "[0: [0: [1-2]], 7: [0: [0: [1-2]]]]")
    ist(set.toString(), "[0: [0: [1-2], 5: [0: [1-2]]]]")
  })
})
