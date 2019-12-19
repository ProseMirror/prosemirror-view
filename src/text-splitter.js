export default function ruleBaseSplit (script) {
  let result = []
  script = script.trim()
  script = script.replace(/[\u201C\u201D]/g, '"')
  const last = script[script.length - 1]
  if (last !== '"' && last !== '.' && last !== '!' && last !== '?') {
    script += '.'
  }

  // quotes split
  const delimiterPattern = /[^\\"\\.\\!\\?\n]*[\\"\\.\\!\\?\n]/g
  let subSplitted = script.match(delimiterPattern)
  if (subSplitted) {
    subSplitted.filter(value => value.replace(/\s/g, '').length).map(value => {
      let ret = splitByMaxLength(value)
      ret.map(item => {
        item = item.trim()
        const pattern = /^[^a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣]+$/
        if (!pattern.test(item)) {
          result.push(item)
        }
      })
    })
  }
  return result
}

function splitByMaxLength (str) {
  let res = []
  const maxLength = 120
  while(str.length > maxLength) {
    let index = str.indexOf(' ', maxLength)
    if (index > -1) {
      res.push(str.substring(0, index))
      str = str.substring(index + 1, str.length)
    } else {
      break
    }
  }
  res.push(str)
  return res
}