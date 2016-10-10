function viewDecorations(view) {
  let found = []
  view.someProp("decorations", f => {
    let result = f(view.state)
    if (result) found.push(result)
  })
  return DecorationGroup.from(found)
}
exports.viewDecorations = viewDecorations

class WidgetDecoration {
  constructor(widget) {
    if (widget.nodeType != 1) {
      let wrap = document.createElement("span")
      wrap.appendChild(widget)
      widget = wrap
    }
    widget.setAttribute("pm-ignore", "true")
    widget.contentEditable = false
    this.widget = widget
  }

  map(mapping, span, offset, oldOffset) {
    let {pos, deleted} = mapping.mapResult(span.from + oldOffset)
    return deleted ? null : new DecorationSpan(pos - offset, pos - offset, this)
  }

  apply(domParent, domNode) {
    domParent.insertBefore(this.widget, domNode)
  }

  static create(pos, widget) {
    return new DecorationSpan(pos, pos, new WidgetDecoration(widget))
  }
}
exports.WidgetDecoration = WidgetDecoration

class InlineDecoration {
  constructor(attrs, options) {
    this.inclusiveLeft = options && options.inclusiveLeft
    this.inclusiveRight = options && options.inclusiveRight
    this.attrs = attrs
  }

  map(mapping, span, offset, oldOffset) {
    let from = mapping.map(span.from + oldOffset, this.inclusiveLeft ? -1 : 1) - offset
    let to = mapping.map(span.to + oldOffset, this.inclusiveRight ? 1 : -1) - offset
    return from >= to ? null : new DecorationSpan(from, to, this)
  }

  apply(_domParent, domNode) {
    for (let attr in this.attrs) {
      if (attr == "class") domNode.classList.add(this.attrs[attr])
      else if (attr == "style") domNode.style.cssText += ";" + this.attrs[attr]
      else domNode.setAttribute(attr, this.attrs[attr])
    }
  }

  static create(from, to, attrs, options) {
    return new DecorationSpan(from, to, new InlineDecoration(attrs, options))
  }
}
exports.InlineDecoration = InlineDecoration

function isInlineDecoration(span) {
  return span.decoration instanceof InlineDecoration
}

class DecorationSpan {
  constructor(from, to, decoration) {
    this.from = from
    this.to = to
    this.decoration = decoration
  }

  copy(from, to) {
    return new DecorationSpan(from, to, this.decoration)
  }

  sameOutput(other) {
    // FIXME deep-compare decoration?
    return this.decoration == other.decoration && this.from == other.from && this.to == other.to
  }

  map(mapping, offset, oldOffset) {
    return this.decoration.map(mapping, this, offset, oldOffset)
  }
}
exports.DecorationSpan = DecorationSpan

const none = []

class DecorationSet {
  constructor(local, children) {
    this.local = local && local.length ? local : none
    this.children = children && children.length ? children : none
  }

  map(mapping, node) {
    return this.mapInner(mapping, node, 0, 0)
  }

  mapInner(mapping, node, offset, oldOffset) {
    let newLocal
    for (let i = 0; i < this.local.length; i++) {
      let mapped = this.local[i].map(mapping, offset, oldOffset)
      if (mapped) (newLocal || (newLocal = [])).push(mapped)
    }

    if (this.children.length)
      return mapChildren(this.children, newLocal, mapping, node, offset, oldOffset)
    else
      return newLocal ? new DecorationSet(newLocal.sort(byPos)) : null
  }

  add(spans, node, offset = 0) {
    if (!spans.length) return this
    let children, childIndex = 0
    node.forEach((childNode, childOffset) => {
      let baseOffset = childOffset + offset, found
      if (!(found = takeSpansForNode(spans, childNode, baseOffset))) return

      if (!children) children = this.children.slice()
      while (childIndex < children.length && children[childIndex] < childOffset) childIndex += 3
      if (children[childIndex] == childOffset)
        children[childIndex + 2] = children[childIndex + 2].add(found, childNode, baseOffset + 1)
      else
        children.splice(childIndex, 0, childOffset, childOffset + childNode.nodeSize, buildTree(found, childNode, baseOffset + 1))
      childIndex += 3
    })

    let local = moveSpans(childIndex ? withoutNulls(spans) : spans, -offset)
    return new DecorationSet(local.length ? this.local.concat(local).sort(byPos) : this.local,
                             children || this.children)
  }

  remove(spans, offset = 0) {
    let children = this.children, local = this.local
    for (let i = 0; i < children.length; i += 3) {
      let found, from = children[i] + offset, to = children[i + 1] + offset
      for (let j = 0, span; j < spans.length; j++) if (span = spans[j]) {
        if (span.from > from && span.to < to) {
          spans[j] = null
          ;(found || (found = [])).push(span)
        }
      }
      if (!found) continue
      if (children == this.children) children = this.children.slice()
      let removed = children[i + 2].remove(found, from + 1)
      if (removed) {
        children[i + 2] = removed
      } else {
        children.splice(i, 3)
        i -= 3
      }
    }
    for (let i = 0, span; i < spans.length; i++) if (span = spans[i]) {
      let decoration = span.decoration
      for (let j = 0; j < local.length; j++) if (local[j].decoration == decoration) {
        if (local == this.local) local = this.local.slice()
        local.splice(j--, 1)
      }
    }
    if (children == this.children && local == this.local) return this
    return local.length || children.length ? new DecorationSet(local, children) : null
  }

  forChild(offset, node) {
    let child, local
    for (let i = 0; i < this.children.length; i += 3) if (this.children[i] >= offset) {
      if (this.children[i] == offset) child = this.children[i + 2]
      break
    }
    let start = offset + 1, end = start + node.content.size
    for (let i = 0; i < this.local.length; i++) {
      let dec = this.local[i]
      if (dec.from < end && dec.to > start)
        (local || (local = [])).push(dec.copy(Math.max(start, dec.from) - start,
                                              Math.min(end, dec.to) - start))
    }
    if (local) {
      local = new DecorationSet(local.sort(byPos))
      return child ? new DecorationGroup([local, child]) : local
    }
    return child || noDecoration
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
    if (node.isTextblock || !this.local.some(isInlineDecoration)) return this.local
    let result = []
    for (let i = 0; i < this.local.length; i++) {
      if (!(this.local[i].decoration instanceof InlineDecoration))
        result.push(this.local[i])
    }
    return result
  }

  static create(doc, decorations) {
    return decorations.length ? buildTree(decorations, doc, 0) : null
  }
}
exports.DecorationSet = DecorationSet

const noDecoration = {
  forChild() { return noDecoration },
  sameOutput(other) { return other == noDecoration },
  locals() { return none }
}
exports.noDecoration = noDecoration

class DecorationGroup {
  constructor(members) {
    this.members = members
  }

  forChild(offset, child) {
    let found = []
    for (let i = 0; i < this.members.length; i++) {
      let result = this.members[i].forChild(offset, child)
      if (result == noDecoration) continue
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
      let locals = this.members[i].locals(node)
      if (!locals.length) continue
      if (!result) {
        result = locals
      } else {
        if (sorted) {
          result = result.splice()
          sorted = false
        }
        for (let j = 0; j < locals.length; j++) result.push(locals[j])
      }
    }
    return result ? (sorted ? result : result.sort(byPos)) : none
  }

  static from(members) {
    switch (members.length) {
      case 0: return noDecoration
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
  for (let i = 0; i < children.length; i += 3) if (children[i + 1] == -1) { // Untouched nodes
    let from = mapping.map(children[i] + oldOffset), fromLocal = from - offset
    // Must read oldChildren because children was tagged with -1
    let to = mapping.map(oldChildren[i + 1] + oldOffset, -1), toLocal = to - offset
    let {index, offset: childOffset} = node.content.findIndex(fromLocal)
    let childNode = node.maybeChild(index)
    if (childNode && childOffset == fromLocal && childOffset + childNode.nodeSize == toLocal) {
      let mapped = children[i + 2].mapInner(mapping, childNode, from + 1, children[i] + oldOffset + 1)
      if (mapped) {
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
    result.push(new DecorationSpan(span.from + offset, span.to + offset, span.decoration))
  }
  return result
}

function mapAndGatherRemainingDecorations(children, decorations, mapping, oldOffset) {
  // Gather all decorations from the remaining marked children
  function gather(node, oldOffset) {
    for (let i = 0; i < node.local.length; i++) {
      let mapped = node.local[i].map(mapping, 0, oldOffset)
      if (mapped) decorations.push(mapped)
    }
    for (let i = 0; i < node.children.length; i += 3)
      gather(node.children[i + 2], node.children[i] + oldOffset + 1)
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

function buildTree(spans, node, offset) {
  let children = []
  node.forEach((childNode, localStart) => {
    let found = takeSpansForNode(spans, childNode, localStart + offset)
    if (found)
      children.push(localStart, localStart + childNode.nodeSize, buildTree(found, childNode, offset + localStart + 1))
  })
  return new DecorationSet(moveSpans(children.length ? withoutNulls(spans) : spans, -offset).sort(byPos), children)
}

function byPos(a, b) {
  return a.from - b.from || a.to - b.to
}

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
