exports.domIndex = function(node) {
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
