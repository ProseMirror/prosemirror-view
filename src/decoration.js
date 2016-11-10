class WidgetType {
  constructor(widget, options) {
    if (widget.nodeType != 1) {
      let wrap = document.createElement("span")
      wrap.appendChild(widget)
      widget = wrap
    }
    widget.setAttribute("pm-ignore", "true")
    widget.contentEditable = false
    this.widget = widget
    this.options = options || noOptions
  }

  map(mapping, span, offset, oldOffset) {
    let {pos, deleted} = mapping.mapResult(span.from + oldOffset)
    return deleted ? null : new Decoration(pos - offset, pos - offset, this)
  }

  valid() { return true }

  apply(domParent, domNode) {
    domParent.insertBefore(this.widget, domNode)
    return domNode
  }
}

class InlineType {
  constructor(attrs, options) {
    this.options = options || noOptions
    this.attrs = attrs
  }

  map(mapping, span, offset, oldOffset) {
    let from = mapping.map(span.from + oldOffset, this.options.inclusiveLeft ? -1 : 1) - offset
    let to = mapping.map(span.to + oldOffset, this.options.inclusiveRight ? 1 : -1) - offset
    return from >= to ? null : new Decoration(from, to, this)
  }

  valid(_, span) { return span.from < span.to }

  apply(_domParent, domNode) {
    return applyContentDecoration(this.attrs, domNode)
  }

  static is(span) { return span.type instanceof InlineType }
}

class NodeType {
  constructor(attrs, options) {
    this.attrs = attrs
    this.options = options || noOptions
  }

  map(mapping, span, offset, oldOffset) {
    let from = mapping.mapResult(span.from + oldOffset, 1)
    if (from.deleted) return null
    let to = mapping.mapResult(span.to + oldOffset, -1)
    if (to.deleted || to.pos <= from.pos) return null
    return new Decoration(from.pos - offset, to.pos - offset, this)
  }

  valid(node, span) {
    let {index, offset} = node.content.findIndex(span.from)
    return offset == span.from && offset + node.child(index).nodeSize == span.to
  }

  apply(_domParent, domNode) {
    return applyContentDecoration(this.attrs, domNode)
  }
}

class DummyType {
  valid() { return true }
  apply() {}
}

function applyContentDecoration(attrs, domNode) {
  for (let name in attrs) {
    let val = attrs[name]
    if (name == "class") domNode.classList.add(...val.split(" "))
    else if (name == "style") domNode.style.cssText += ";" + val
    else if (name != "wrapper") domNode.setAttribute(name, val)
  }
  let wrap = attrs.wrapper
  return wrap ? wrapNode(domNode, wrap) : domNode
}

function wrapNode(domNode, wrapper) {
  domNode.parentNode.replaceChild(wrapper, domNode)
  let position = wrapper.querySelector("[pm-placeholder]")
  if (position && position != wrapper) {
    position.parentNode.replaceChild(domNode, position)
    domNode.setAttribute("pm-placeholder", "true")
  } else {
    wrapper.appendChild(domNode)
  }
  wrapper.setAttribute("pm-size", domNode.getAttribute("pm-size"))
  domNode.removeAttribute("pm-size")
  wrapper.setAttribute("pm-offset", domNode.getAttribute("pm-offset"))
  domNode.removeAttribute("pm-offset")
  wrapper.setAttribute("pm-decoration", "true")
  return wrapper
}

// ::- Decorations can be provided to the view (through the
// [`decorations` prop](#view.EditorProps.decorations)) to adjust the
// way the document is drawn. They come in several variants. See the
// static members of this class for details.
class Decoration {
  constructor(from, to, type) {
    this.from = from
    this.to = to
    this.type = type
  }

  copy(from, to) {
    return new Decoration(from, to, this.type)
  }

  sameOutput(other) {
    return this.type == other.type && this.from == other.from && this.to == other.to
  }

  map(mapping, offset, oldOffset) {
    return this.type.map(mapping, this, offset, oldOffset)
  }

  // :: (number, dom.Node, ?Object) → Decoration
  // Creates a widget decoration, which is a DOM node that's shown in
  // the document at the given position.
  static widget(pos, widget, options) {
    return new Decoration(pos, pos, new WidgetType(widget, options))
  }

  // :: (number, number, DecorationAttrs, ?Object) → Decoration
  // Creates an inline decoration, which adds the given attributes to
  // each inline node between `from` and `to`.
  //
  //   options::- These options are recognized:
  //
  //     inclusiveLeft:: ?bool
  //     Determines how the left side of the decoration is
  //     [mapped](#transform.Position_Mapping) when content is
  //     inserted directly at that positon. By default, the decoration
  //     won't include the new content, but you can set this to `true`
  //     to make it inclusive.
  //
  //     inclusiveRight:: ?bool
  //     Determines how the right side of the decoration is mapped.
  //     See
  //     [`inclusiveLeft`](#view.Decoration^inline^options.inclusiveLeft).
  static inline(from, to, attrs, options) {
    return new Decoration(from, to, new InlineType(attrs, options))
  }

  // :: (number, number, DecorationAttrs, ?Object) → Decoration
  // Creates a node decoration. `from` and `to` should point precisely
  // before and after a node in the document. That node, and only that
  // node, will receive the given attributes.
  static node(from, to, attrs, options) {
    return new Decoration(from, to, new NodeType(attrs, options))
  }

  // :: Object
  // The options provided when creating this decoration. Can be useful
  // if you've stored extra information in that object.
  get options() { return this.type.options }
}
exports.Decoration = Decoration

// DecorationAttrs:: interface
// A set of attributes to add to a decorated node. Most properties
// simply directly correspond to DOM attributes of the same name,
// which will be set to the property's value. These are exceptions:
//
//   class:: ?string
//   A CSS class name or a space-separated set of class names to be
//   _added_ to the classes that the node already had.
//
//   style:: ?string
//   A string of CSS to be _added_ to the node's existing `style` property.
//
//   wrapper:: ?dom.Node
//   A DOM node to use as a wrapper around the original node. Will be
//   applied after the other properties. By default, the original node
//   will be appended to this. If you put a child node with a
//   `pm-placeholder` attribute in the node, that node will be
//   replaced with the original node.

const none = [], noOptions = {}

// ::- A collection of [decorations](#view.Decoration), organized in
// such a way that the drawing algorithm can efficiently use and
// compare them. This is a persistent data structure—it is not
// modified, updates create a new value.
class DecorationSet {
  constructor(local, children) {
    this.local = local && local.length ? local : none
    this.children = children && children.length ? children : none
  }

  // :: (Node, [Decoration]) → DecorationSet
  // Create a set of decorations, using the structure of the given
  // document.
  static create(doc, decorations) {
    return decorations.length ? buildTree(decorations, doc, 0) : empty
  }

  // :: (?number, ?number) → [Decoration]
  // Find all decorations in this set which touch the given range
  // (including decorations that start or end directly at the
  // boundaries). When the arguments are omitted, all decorations in
  // the set are collected.
  find(start, end) {
    let result = []
    this.findInner(start == null ? 0 : start, end == null ? 1e9 : end, result, 0)
    return result
  }

  findInner(start, end, result, offset) {
    for (let i = 0; i < this.local.length; i++) {
      let span = this.local[i]
      if (span.from <= end && span.to >= start)
        result.push(span.copy(span.from + offset, span.to + offset))
    }
    for (let i = 0; i < this.children.length; i += 3) {
      if (this.children[i] < end && this.children[i + 1] > start) {
        let childOff = this.children[i] + 1
        this.children[i + 2].findInner(start - childOff, end - childOff, result, offset + childOff)
      }
    }
  }

  // :: (Mapping, Node) → DecorationSet
  // Map the set of decorations in response to a change in the
  // document.
  map(mapping, doc) {
    if (this == empty) return this
    return this.mapInner(mapping, doc, 0, 0)
  }

  mapInner(mapping, node, offset, oldOffset) {
    let newLocal
    for (let i = 0; i < this.local.length; i++) {
      let mapped = this.local[i].map(mapping, offset, oldOffset)
      if (mapped && mapped.type.valid(node, mapped)) (newLocal || (newLocal = [])).push(mapped)
    }

    if (this.children.length)
      return mapChildren(this.children, newLocal, mapping, node, offset, oldOffset)
    else
      return newLocal ? new DecorationSet(newLocal.sort(byPos)) : empty
  }

  // :: (Node, [Decoration]) → DecorationSet
  // Add the given array of decorations to the ones in the set,
  // producing a new set. Needs access to the current document to
  // create the appropriate tree structure.
  add(doc, decorations) {
    if (!decorations.length) return this
    if (this == empty) return DecorationSet.create(doc, decorations)
    return this.addInner(doc, decorations, 0)
  }

  addInner(doc, decorations, offset) {
    let children, childIndex = 0
    doc.forEach((childNode, childOffset) => {
      let baseOffset = childOffset + offset, found
      if (!(found = takeSpansForNode(decorations, childNode, baseOffset))) return

      if (!children) children = this.children.slice()
      while (childIndex < children.length && children[childIndex] < childOffset) childIndex += 3
      if (children[childIndex] == childOffset)
        children[childIndex + 2] = children[childIndex + 2].addInner(childNode, found, baseOffset + 1)
      else
        children.splice(childIndex, 0, childOffset, childOffset + childNode.nodeSize, buildTree(found, childNode, baseOffset + 1))
      childIndex += 3
    })

    let local = moveSpans(childIndex ? withoutNulls(decorations) : decorations, -offset)
    return new DecorationSet(local.length ? this.local.concat(local).sort(byPos) : this.local,
                             children || this.children)
  }

  // :: ([Decoration]) → DecorationSet
  // Create a new set that contains the decorations in this set, minus
  // the ones in the given array.
  remove(decorations) {
    if (decorations.length == 0 || this == empty) return this
    return this.removeInner(decorations, 0)
  }

  removeInner(decorations, offset) {
    let children = this.children, local = this.local
    for (let i = 0; i < children.length; i += 3) {
      let found, from = children[i] + offset, to = children[i + 1] + offset
      for (let j = 0, span; j < decorations.length; j++) if (span = decorations[j]) {
        if (span.from > from && span.to < to) {
          decorations[j] = null
          ;(found || (found = [])).push(span)
        }
      }
      if (!found) continue
      if (children == this.children) children = this.children.slice()
      let removed = children[i + 2].removeInner(found, from + 1)
      if (removed != empty) {
        children[i + 2] = removed
      } else {
        children.splice(i, 3)
        i -= 3
      }
    }
    if (local.length) for (let i = 0, span; i < decorations.length; i++) if (span = decorations[i]) {
      for (let j = 0; j < local.length; j++) if (local[j].type == span.type) {
        if (local == this.local) local = this.local.slice()
        local.splice(j--, 1)
      }
    }
    if (children == this.children && local == this.local) return this
    return local.length || children.length ? new DecorationSet(local, children) : empty
  }

  forChild(offset, node) {
    if (this == empty) return this
    if (node.isLeaf) return DecorationSet.empty

    let child, local
    for (let i = 0; i < this.children.length; i += 3) if (this.children[i] >= offset) {
      if (this.children[i] == offset) child = this.children[i + 2]
      break
    }
    let start = offset + 1, end = start + node.content.size
    for (let i = 0; i < this.local.length; i++) {
      let dec = this.local[i]
      if (dec.from < end && dec.to > start && (dec.type instanceof InlineType)) {
        let from = Math.max(start, dec.from) - start, to = Math.min(end, dec.to) - start
        if (from < to) (local || (local = [])).push(dec.copy(from, to))
      }
    }
    if (local) {
      let localSet = new DecorationSet(local)
      return child ? new DecorationGroup([localSet, child]) : localSet
    }
    return child || empty
  }

  sameOutput(other) {
    if (this == other) return true
    if (!(other instanceof DecorationSet) ||
        this.local.length != other.local.length ||
        this.children.length != other.children.length) return false
    for (let i = 0; i < this.local.length; i++)
      if (!this.local[i].sameOutput(other.local[i])) return false
    for (let i = 0; i < this.children.length; i += 3)
      if (this.children[i] != other.children[i] ||
          this.children[i + 1] != other.children[i + 1] ||
          !this.children[i + 2].sameOutput(other.children[i + 2])) return false
    return false
  }

  locals(node) {
    return removeOverlap(this.localsInner(node))
  }

  localsInner(node) {
    if (this == empty) return none
    if (node.isTextblock || !this.local.some(InlineType.is)) return this.local
    let result = []
    for (let i = 0; i < this.local.length; i++) {
      if (!(this.local[i].type instanceof InlineType))
        result.push(this.local[i])
    }
    return result
  }
}
exports.DecorationSet = DecorationSet

const empty = new DecorationSet()

// :: DecorationSet
// The empty set of decorations.
DecorationSet.empty = empty

class DecorationGroup {
  constructor(members) {
    this.members = members
  }

  forChild(offset, child) {
    if (child.isLeaf) return DecorationSet.empty
    let found = []
    for (let i = 0; i < this.members.length; i++) {
      let result = this.members[i].forChild(offset, child)
      if (result == empty) continue
      if (result instanceof DecorationGroup) found = found.concat(result.members)
      else found.push(result)
    }
    return DecorationGroup.from(found)
  }

  sameOutput(other) {
    if (!(other instanceof DecorationGroup) ||
        other.members.length != this.members.length) return false
    for (let i = 0; i < this.members.length; i++)
      if (!this.members[i].sameOutput(other.members[i])) return false
    return true
  }

  locals(node) {
    let result, sorted = true
    for (let i = 0; i < this.members.length; i++) {
      let locals = this.members[i].localsInner(node)
      if (!locals.length) continue
      if (!result) {
        result = locals
      } else {
        if (sorted) {
          result = result.slice()
          sorted = false
        }
        for (let j = 0; j < locals.length; j++) result.push(locals[j])
      }
    }
    return result ? removeOverlap(sorted ? result : result.sort(byPos)) : none
  }

  static from(members) {
    switch (members.length) {
      case 0: return empty
      case 1: return members[0]
      default: return new DecorationGroup(members)
    }
  }
}
exports.DecorationGroup = DecorationGroup

function mapChildren(oldChildren, newLocal, mapping, node, offset, oldOffset) {
  let children = oldChildren.slice()

  // Mark the children that are directly touched by changes, and
  // move those after changes.
  let shift = (oldStart, oldEnd, newStart, newEnd) => {
    for (let i = 0; i < children.length; i += 3) {
      let end = children[i + 1], dSize
      if (end == -1 || oldStart > end + oldOffset) continue
      if (oldEnd >= children[i] + oldOffset) {
        children[i + 1] = -1
      } else if (dSize = (newEnd - newStart) - (oldEnd - oldStart)) {
        children[i] += dSize
        children[i + 1] += dSize
      }
    }
  }
  for (let i = 0; i < mapping.maps.length; i++) mapping.maps[i].forEach(shift)

  // Find the child nodes that still correspond to a single node,
  // recursively call mapInner on them and update their positions.
  let mustRebuild = false
  for (let i = 0; i < children.length; i += 3) if (children[i + 1] == -1) { // Touched nodes
    let from = mapping.map(children[i] + oldOffset), fromLocal = from - offset
    if (fromLocal >= node.content.size) {
      mustRebuild = true
      continue
    }
    // Must read oldChildren because children was tagged with -1
    let to = mapping.map(oldChildren[i + 1] + oldOffset, -1), toLocal = to - offset
    let {index, offset: childOffset} = node.content.findIndex(fromLocal)
    let childNode = node.maybeChild(index)
    if (childNode && childOffset == fromLocal && childOffset + childNode.nodeSize == toLocal) {
      let mapped = children[i + 2].mapInner(mapping, childNode, from + 1, children[i] + oldOffset + 1)
      if (mapped != empty) {
        children[i] = fromLocal
        children[i + 1] = toLocal
        children[i + 2] = mapped
      } else {
        children.splice(i, 3)
        i -= 3
      }
    } else {
      mustRebuild = true
    }
  }

  // Remaining children must be collected and rebuilt into the appropriate structure
  if (mustRebuild) {
    let decorations = mapAndGatherRemainingDecorations(children, newLocal ? moveSpans(newLocal, offset) : [], mapping, oldOffset)
    let built = buildTree(decorations, node, 0)
    newLocal = built.local
    for (let i = 0; i < children.length; i += 3) if (children[i + 1] == -1) {
      children.splice(i, 3)
      i -= 3
    }
    for (let i = 0, j = 0; i < built.children.length; i += 3) {
      let from = built.children[i]
      while (j < children.length && children[j] < from) j += 3
      children.splice(j, 0, built.children[i], built.children[i + 1], built.children[i + 2])
    }
  }

  return new DecorationSet(newLocal && newLocal.sort(byPos), children)
}

function moveSpans(spans, offset) {
  if (!offset || !spans.length) return spans
  let result = []
  for (let i = 0; i < spans.length; i++) {
    let span = spans[i]
    result.push(new Decoration(span.from + offset, span.to + offset, span.type))
  }
  return result
}

function mapAndGatherRemainingDecorations(children, decorations, mapping, oldOffset) {
  // Gather all decorations from the remaining marked children
  function gather(set, oldOffset) {
    for (let i = 0; i < set.local.length; i++) {
      let mapped = set.local[i].map(mapping, 0, oldOffset)
      if (mapped) decorations.push(mapped)
    }
    for (let i = 0; i < set.children.length; i += 3)
      gather(set.children[i + 2], set.children[i] + oldOffset + 1)
  }
  for (let i = 0; i < children.length; i += 3) if (children[i + 1] == -1)
    gather(children[i + 2], children[i] + oldOffset + 1)

  return decorations
}

function takeSpansForNode(spans, node, offset) {
  if (node.isLeaf) return null
  let end = offset + node.nodeSize, found = null
  for (let i = 0, span; i < spans.length; i++) {
    if ((span = spans[i]) && span.from > offset && span.to < end) {
      ;(found || (found = [])).push(span)
      spans[i] = null
    }
  }
  return found
}

function withoutNulls(array) {
  let result = []
  for (let i = 0; i < array.length; i++)
    if (array[i] != null) result.push(array[i])
  return result
}

// : ([Decoration], Node, number) → DecorationSet
// Build up a tree that corresponds to a set of decorations. `offset`
// is a base offset that should be subtractet from the `from` and `to`
// positions in the spans (so that we don't have to allocate new spans
// for recursive calls).
function buildTree(spans, node, offset) {
  let children = [], hasNulls = false
  node.forEach((childNode, localStart) => {
    let found = takeSpansForNode(spans, childNode, localStart + offset)
    if (found) {
      hasNulls = true
      let subtree = buildTree(found, childNode, offset + localStart + 1)
      if (subtree != empty)
        children.push(localStart, localStart + childNode.nodeSize, subtree)
    }
  })
  let locals = moveSpans(hasNulls ? withoutNulls(spans) : spans, -offset).sort(byPos)
  for (let i = 0; i < locals.length; i++)
    if (!locals[i].type.valid(node, locals[i])) locals.splice(i--, 1)
  return locals.length || children.length ? new DecorationSet(locals, children) : empty
}

// : (Decoration, Decoration) → number
// Used to sort decorations so that ones with a low start position
// come first, and within a set with the same start position, those
// with an smaller end position come first.
function byPos(a, b) {
  return a.from - b.from || a.to - b.to
}

// : ([Decoration]) → [Decorations]
// Scan a sorted array of decorations for partially overlapping spans,
// and split those so that only fully overlapping spans are left (to
// make subsequent rendering easier). Will return the input array if
// no partially overlapping spans are found (the common case).
function removeOverlap(spans) {
  let working = spans
  for (let i = 0; i < working.length - 1; i++) {
    let span = working[i]
    if (span.from != span.to) for (let j = i + 1; j < working.length; j++) {
      let next = working[j]
      if (next.from == span.from) {
        if (next.to != span.to) {
          if (working == spans) working = spans.slice()
          // Followed by a partially overlapping larger span. Split that
          // span.
          working[j] = next.copy(next.from, span.to)
          insertAhead(working, j + 1, next.copy(span.to, next.to))
        }
        continue
      } else {
        if (next.from < span.to) {
          if (working == spans) working = spans.slice()
          // The end of this one overlaps with a subsequent span. Split
          // this one.
          working[i] = span.copy(span.from, next.from)
          insertAhead(working, j, span.copy(next.from, span.to))
        }
        break
      }
    }
  }
  return working
}
exports.removeOverlap = removeOverlap

function insertAhead(array, i, deco) {
  while (i < array.length && byPos(deco, array[i]) > 0) i++
  array.splice(i, 0, deco)
}

// : (EditorView) → union<DecorationSet, DecorationGroup>
// Get the decorations associated with the current props of a view.
function viewDecorations(view) {
  let found = []
  view.someProp("decorations", f => {
    let result = f(view.state)
    if (result && result != empty) found.push(result)
  })
  return DecorationGroup.from(found)
}
exports.viewDecorations = viewDecorations

function addDummy(decorations, doc, from, to) {
  let dummy = DecorationSet.create(doc, [new Decoration(from, to, new DummyType)])
  if (decorations == empty) return dummy
  let others = decorations instanceof DecorationGroup ? decorations.members : [decorations]
  return new DecorationGroup(others.concat(dummy))
}
exports.addDummy = addDummy
