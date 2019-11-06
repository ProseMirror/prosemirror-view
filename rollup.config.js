import buble from '@rollup/plugin-buble'

export default {
  input: './src/index.js',
  output: {
    dir: 'dist',
    format: 'cjs',
    sourcemap: true
  },
  plugins: [buble()],
  external(id) { return !/^[\.\/]/.test(id) }
}
