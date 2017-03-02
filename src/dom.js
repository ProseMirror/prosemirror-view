const domIndex = exports.domIndex = function(node) {
  for (var index = 0;; index++) {
    node = node.previousSibling
    if (!node) return index
  }
}

exports.parentNode = function(node) {
  let parent = node.parentNode
  return parent.nodeType == 11 ? parent.host : parent
}

exports.textRange = function(node, from, to) {
  let range = document.createRange()
  range.setEnd(node, to == null ? node.nodeValue.length : to)
  range.setStart(node, from || 0)
  return range
}

// Scans forward and backward through DOM positions equivalent to the
// given one to see if the two are in the same place (i.e. after a
// text node vs at the end of that text node)
exports.isEquivalentPosition = function(node, off, targetNode, targetOff) {
  return targetNode && (scanFor(node, off, targetNode, targetOff, -1) ||
                        scanFor(node, off, targetNode, targetOff, 1))
}

function scanFor(node, off, targetNode, targetOff, dir) {
  for (;;) {
    if (node == targetNode && off == targetOff) return true
    if (off == (dir < 0 ? 0 : nodeSize(node))) {
      let parent = node.parentNode
      if (parent.nodeType != 1 || hasBlockDesc(parent)) return false
      off = domIndex(node) + (dir < 0 ? 0 : 1)
      node = parent
    } else if (node.nodeType == 1) {
      node = node.childNodes[off + (dir < 0 ? -1 : 0)]
      off = dir < 0 ? nodeSize(node) : 0
    } else {
      return false
    }
  }
}

function nodeSize(node) {
  return node.nodeType == 3 ? node.nodeValue.length : node.childNodes.length
}

function hasBlockDesc(dom) {
  let desc = dom.pmViewDesc
  return desc && desc.node && desc.node.isBlock
}
