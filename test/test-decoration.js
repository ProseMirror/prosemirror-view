const ist = require("ist")
const {eq, schema, doc, p, blockquote} = require("prosemirror-model/test/build")
const {Transform} = require("prosemirror-transform")

const { Decoration, DecorationSet } = require("../dist/decoration")

function build(doc, ...decorations) {
  return DecorationSet.create(doc, decorations.map(d => new Decoration(d.start, d.end, d)))
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
    let d = doc(p("foo"), p("bar"))
    let set = build(d, {start: 2, end: 3}, {start: 7, end: 8})
    ist(set.toString(), "[0: [1-2], 5: [1-2]]")
    let tr = new Transform(d).replaceWith(4, 4, schema.text("!!"))
    ist(set.map(tr.mapping, tr.doc).toString(), "[0: [1-2], 7: [1-2]]")
  })

  it("preserves subtrees not touched by mapping", () => {
    let d = doc(p("foo"), blockquote(p("bar"), p("baz")))
    let set = build(d, {start: 2, end: 3}, {start: 8, end: 9}, {start: 13, end: 14})
    let tr = new Transform(d).delete(8, 9)
    let newSet = set.map(tr.mapping, tr.doc)
    ist(newSet.toString(), "[0: [1-2], 5: [4: [1-2]]]")
    ist(newSet.children[2], set.children[2])
    ist(newSet.children[5].children[2], set.children[5].children[5])
  })

  it("rebuilds when a node is joined", () => {
    let d = doc(p("foo"), p("bar"))
    let set = build(d, {start: 2, end: 3}, {start: 7, end: 8})
    let tr = new Transform(d).join(5)
    ist(set.map(tr.mapping, tr.doc).toString(), "[0: [1-2, 4-5]]")
  })

  it("rebuilds when a node is split", () => {
    let d = doc(p("foobar"))
    let set = build(d, {start: 2, end: 3}, {start: 5, end: 6})
    let tr = new Transform(d).split(4)
    ist(set.map(tr.mapping, tr.doc).toString(), "[0: [1-2], 5: [1-2]]")
  })

  it("correctly rebuilds a deep structure", () => {
    let d = doc(blockquote(p("foo")), blockquote(blockquote(p("bar"))))
    let set = build(d, {start: 3, end: 4}, {start: 11, end: 12})
    ist(set.toString(), "[0: [0: [1-2]], 7: [0: [0: [1-2]]]]")
    let tr = new Transform(d).join(7)
    ist(set.map(tr.mapping, tr.doc).toString(), "[0: [0: [1-2], 5: [0: [1-2]]]]")
  })
})
