// declare global: mocha
mocha.setup("bdd")

require("./test-draw")
require("./test-selection")
require("./test-domchange")
require("./test-decoration")
require("./test-draw-decoration")

mocha.run()
