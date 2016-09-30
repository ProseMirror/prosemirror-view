class Decoration {
  constructor(start, end, options) {
    this.start = start
    this.end = end
    this.options = options
  }

  eq(other) {
    return this.options == other.options && this.start == other.start && this.end == other.end
  }

  map(mapping, offset, oldOffset) {
    let start = mapping.map(this.start + oldOffset, this.options.inclusiveLeft ? -1 : 1) - offset
    let end = mapping.map(this.end + oldOffset, this.options.inclusiveRight ? 1 : -1) - offset
    if (start >= end) {
      if (!this.options.persistent) return null
      else end = start
    }
    return new Decoration(start, end, this.options)
  }
}
exports.Decoration = Decoration

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
      return newLocal ? new DecorationSet(newLocal) : null
  }

  toString() {
    let str = "[" + this.local.map(d => d.start + "-" + d.end).join(", ")
    for (let i = 0; i < this.children.length; i += 3)
      str += (str.length > 1 ? ", " : "") + this.children[i] + ": " + this.children[i + 2].toString()
    return str + "]"
  }

  static create(doc, decorations) {
    return buildTree(decorations, doc, 0)
  }
}
exports.DecorationSet = DecorationSet

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
    let start = mapping.map(children[i] + oldOffset), startLocal = start - offset
    // Must read oldChildren because children was tagged with -1
    let end = mapping.map(oldChildren[i + 1] + oldOffset, -1), endLocal = end - offset
    let {index, offset: childOffset} = node.content.findIndex(startLocal)
    let childNode = node.maybeChild(index)
    if (childNode && childOffset == startLocal && childOffset + childNode.nodeSize == endLocal) {
      let mapped = children[i + 2].mapInner(mapping, childNode, start + 1, children[i] + oldOffset + 1)
      if (mapped) {
        children[i] = startLocal
        children[i + 1] = endLocal
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
    let decorations = mapAndGatherRemainingDecorations(children, newLocal ? moveDecorations(newLocal, offset) : [], mapping, oldOffset)
    let built = buildTree(decorations, node, 0)
    newLocal = built.local
    for (let i = 0; i < children.length; i += 3) if (children[i + 1] == -1) {
      children.splice(i, 3)
      i -= 3
    }
    for (let i = 0, j = 0; i < built.children.length; i += 3) {
      let start = built.children[i]
      while (j < children.length && children[j] < start) j += 3
      children.splice(j, 0, built.children[i], built.children[i + 1], built.children[i + 2])
    }
  }

  return new DecorationSet(newLocal, children)
}

function moveDecorations(decorations, offset) {
  if (offset) for (let i = 0; i < decorations.length; i++) {
    decorations[i].start += offset
    decorations[i].end += offset
  }
  return decorations
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

function buildTree(decorations, node, offset) {
  let children = []
  node.forEach((childNode, localStart) => {
    if (childNode.isLeaf) return
    let start = offset + localStart, end = start + childNode.nodeSize, found = []
    for (let i = 0, dec; i < decorations.length; i++) {
      if ((dec = decorations[i]) && dec.start > start && dec.end < end) {
        found.push(dec)
        decorations[i] = null
      }
    }
    if (found.length)
      children.push(localStart, end - offset, buildTree(found, childNode, offset + localStart + 1))
  })
  
  return new DecorationSet(moveDecorations(decorations.filter(x => x), -offset), children)
}
