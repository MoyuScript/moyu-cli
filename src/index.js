#!/usr/bin/env node

const {Command} = require('commander')
const fs = require('fs')
const path = require('path')

const cmd = new Command('moyu')

const moduleRoot = path.resolve(__dirname, './commands/')

fs.readdirSync(moduleRoot).filter(p => {
  return fs.statSync(path.join(moduleRoot, p)).isFile() && p.endsWith('.js')
}).forEach(m => cmd.addCommand(require(path.join(moduleRoot, m)).command))


cmd.parse(process.argv)
