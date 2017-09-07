module.exports = {
  input: "./src/index.js",
  output: {format: "cjs", file: "dist/index.js"},
  sourcemap: true,
  plugins: [require("rollup-plugin-buble")()],
  external(id) { return !/^[\.\/]/.test(id) }
}
