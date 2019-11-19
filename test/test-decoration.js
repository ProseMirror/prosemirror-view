const ist = require("ist")
const {schema, doc, p, h1, li, ul, blockquote} = require("prosemirror-test-builder")
const {Transform} = require("prosemirror-transform")

const {Decoration, DecorationSet} = require("..")

let widget = document.createElement("button")

function make(d) {
  if (d.type) return d
  if (d.pos != null) return Decoration.widget(d.pos, d.widget || widget, d)
  if (d.node) return Decoration.node(d.from, d.to, d.attrs || {}, d)
  return Decoration.inline(d.from, d.to, d.attrs || {}, d)
}

function build(doc, ...decorations) {
  return DecorationSet.create(doc, decorations.map(make))
}

function str(set) {
  if (!set) return "[]"
  let s = "[" + set.local.map(d => d.from + "-" + d.to).join(", ")
  for (let i = 0; i < set.children.length; i += 3)
    s += (s.length > 1 ? ", " : "") + set.children[i] + ": " + str(set.children[i + 2])
  return s + "]"
}

function arrayStr(arr) {
  return arr.map(d => d.from + "-" + d.to).join(", ")
}

function buildMap(doc, ...decorations) {
  let f = decorations.pop()
  let oldSet = build(doc, ...decorations)
  let tr = f(new Transform(doc))
  return {set: oldSet.map(tr.mapping, tr.doc), oldSet}
}

function buildAdd(doc, ...decorations) {
  let toAdd = decorations.pop()
  return build(doc, ...decorations).add(doc, Array.isArray(toAdd) ? toAdd.map(make) : [make(toAdd)])
}

function buildRem(doc, ...decorations) {
  let toAdd = decorations.pop()
  return build(doc, ...decorations).remove(Array.isArray(toAdd) ? toAdd.map(make) : [make(toAdd)])
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

  it("puts node decorations in the parent node", () => {
    let set = build(doc(p("a"), p("b")), {from: 3, to: 6, node: true})
    ist(str(set), "[3-6]")
  })

  it("drops empty inline decorations", () => {
    let set = build(doc(p()), {from: 1, to: 1})
    ist(str(set), "[]")
  })

  describe("find", () => {
    it("finds all when no arguments are given", () => {
      let set = build(doc(p("a"), p("b")), {from: 1, to: 2}, {pos: 3})
      ist(arrayStr(set.find()), "3-3, 1-2")
    })

    it("finds only those within the given range", () => {
      let set = build(doc(p("a"), p("b")), {from: 1, to: 2}, {pos: 1}, {from: 4, to: 5})
      ist(arrayStr(set.find(0, 3)), "1-1, 1-2")
    })

    it("finds decorations at the edge of the range", () => {
      let set = build(doc(p("a"), p("b")), {from: 1, to: 2}, {pos: 3}, {from: 4, to: 5})
      ist(arrayStr(set.find(2, 3)), "3-3, 1-2")
    })

    it("returns the correct offset for deeply nested decorations", () => {
      let set = build(doc(blockquote(blockquote(p("a")))), {from: 3, to: 4})
      ist(arrayStr(set.find()), "3-4")
    })

    it("can filter by predicate", () => {
      let set = build(doc(blockquote(blockquote(p("a")))), {from: 3, to: 4, name: "X"}, {from: 3, to: 4, name: "Y"})
      ist(set.find(undefined, undefined, x => x.name == "Y").map(d => d.spec.name).join(), "Y")
    })
  })

  describe("map", () => {
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

    it("can map node decorations", () => {
      let {set} = buildMap(doc(blockquote(p("a"), p("b"))), {from: 4, to: 7, node: true}, tr => tr.delete(1, 4))
      ist(str(set), "[0: [0-3]]")
    })

    it("can map inside node decorations", () => {
      let {set} = buildMap(doc(blockquote(p("a"), p("b"))), {from: 4, to: 7, node: true}, tr => tr.replaceWith(5, 5, schema.text("c")))
      ist(str(set), "[0: [3-7]]")
    })

    it("removes partially overwritten node decorations", () => {
      let {set} = buildMap(doc(p("a"), p("b")), {from: 0, to: 3, node: true}, tr => tr.delete(2, 4))
      ist(str(set), "[]")
    })

    it("removes exactly overwritten node decorations", () => {
      let {set} = buildMap(doc(p("a"), p("b")), {from: 0, to: 3, node: true},
                           tr => tr.replaceWith(0, 3, schema.nodes.horizontal_rule.create()))
      ist(str(set), "[]")
    })

    it("isn't inclusive by default", () => {
      let {set} = buildMap(doc(p("foo")), {from: 2, to: 3},
                           tr => tr.replaceWith(2, 2, schema.text(".")).replaceWith(4, 4, schema.text("?")))
      ist(str(set), "[0: [2-3]]")
    })

    it("understands unclusiveLeft", () => {
      let {set} = buildMap(doc(p("foo")), {from: 2, to: 3, inclusiveStart: true},
                           tr => tr.replaceWith(2, 2, schema.text(".")).replaceWith(4, 4, schema.text("?")))
      ist(str(set), "[0: [1-3]]")
    })

    it("understands unclusiveRight", () => {
      let {set} = buildMap(doc(p("foo")), {from: 2, to: 3, inclusiveEnd: true},
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

    it("calls onRemove when dropping decorations", () => {
      let d = doc(blockquote(p("hello"), p("abc")))
      let set = build(d, {from: 3, to: 5, name: "a"}, {pos: 10, name: "b"})
      let tr = new Transform(d).delete(2, 6), dropped = []
      set.map(tr.mapping, tr.doc, {onRemove: o => dropped.push(o.name)})
      ist(JSON.stringify(dropped), '["a"]')
      let tr2 = new Transform(d).delete(0, d.content.size), dropped2 = []
      set.map(tr2.mapping, tr2.doc, {onRemove: o => dropped2.push(o.name)})
      ist(JSON.stringify(dropped2.sort()), '["a","b"]')
    })

    it("respects the side option on widgets", () => {
      let d = doc(p("foo"))
      let set = build(d, {pos: 3, side: -1, name: "a"}, {pos: 3, name: "b"})
      let tr = new Transform(d).replaceWith(3, 3, schema.text("ay"))
      let result = set.map(tr.mapping, tr.doc).find().map(d => d.from + "-" + d.spec.name).sort().join(", ")
      ist(result, "3-a, 5-b")
    })

    it("doesn't doubly map decorations nested in multiple nodes", () => {
      let d = doc(h1("u"), blockquote(p()))
      let set = build(d, {pos: 5})
      let tr = new Transform(d).replaceWith(0, 3, schema.node("heading", {level: 1}))
      ist(set.map(tr.mapping, tr.doc).find().map(d => d.from).join(), "4")
    })

    it("rebuilds subtrees correctly at an offset", () => {
      let d = doc(p("foobar"), ul(li(p("abc")), li(p("b"))))
      let set = build(d, {pos: 18})
      let tr = new Transform(d).join(16)
      ist(set.map(tr.mapping, tr.doc).find().map(d => d.from).join(), "16")
    })

    it("properly maps decorations after deleted siblings", () => {
      let d = doc(blockquote(blockquote(blockquote(p()), blockquote(p())),
                             blockquote(blockquote(p()), blockquote(p()))))
      let set = build(d, {pos: 14})
      let tr = new Transform(d).delete(2, 6).delete(8, 12)
      ist(set.map(tr.mapping, tr.doc).find().length, 0)
    })
  })

  describe("add", () => {
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

    it("can add multiple decorations", () => {
      ist(str(buildAdd(doc(p("foo"), p("bar")), {pos: 1}, {from: 6, to: 9},
                       [{from: 1, to: 4}, {pos: 7}, {pos: 8}])),
          "[0: [0-0, 0-3], 5: [0-3, 1-1, 2-2]]")
    })
  })

  describe("remove", () => {
    it("can delete a decoration", () => {
      let d = make({pos: 2})
      ist(str(buildRem(doc(p("foo")), {pos: 1}, d, d)), "[0: [0-0]]")
    })

    it("can delete multiple decorations", () => {
      let d1 = make({pos: 2}), d2 = make({from: 2, to: 8})
      ist(str(buildRem(doc(p("foo"), p("bar")), {pos: 1}, {from: 6, to: 7}, d1, d2, [d1, d2])),
          "[0: [0-0], 5: [0-1]]")

    })

    it("ignores decorations that don't exist", () => {
      ist(str(buildRem(doc(p("foo")), {pos: 5}, {pos: 2})), "[5-5]")
    })
  })
})

describe("removeOverlap", () => {
  it("returns the original array when there is no overlap", () => {
    let decs = [make({pos: 1}), make({from: 1, to: 4}), make({from: 1, to: 4})]
    ist(DecorationSet.removeOverlap(decs), decs)
  })

  it("splits a partially overlapping decoration", () => {
    let decs = [make({from: 1, to: 2}), make({from: 1, to: 4}), make({from: 3, to: 4})]
    ist(arrayStr(DecorationSet.removeOverlap(decs)), "1-2, 1-2, 2-3, 3-4, 3-4")
  })

  it("splits a decoration that spans multiple widgets", () => {
    let decs = [make({from: 1, to: 5}), make({pos: 2}), make({pos: 3})]
    ist(arrayStr(DecorationSet.removeOverlap(decs)), "1-2, 2-2, 2-3, 3-3, 3-5")
  })

  it("correctly splits overlapping inline decorations", () => {
    let decs = [make({from: 0, to: 6}), make({from: 1, to: 4}), make({from: 3, to: 5})]
    ist(arrayStr(DecorationSet.removeOverlap(decs)), "0-1, 1-3, 1-3, 3-4, 3-4, 3-4, 4-5, 4-5, 5-6")
  })
})
