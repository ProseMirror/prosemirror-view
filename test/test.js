require("mocha/mocha")

// declare global: mocha
mocha.setup("bdd")

require("./test-view")
require("./test-draw")
require("./test-selection")
require("./test-domchange")
require("./test-composition")
require("./test-decoration")
require("./test-draw-decoration")
require("./test-nodeview")
require("./test-clipboard")
require("./test-endOfTextblock")

mocha.run()
