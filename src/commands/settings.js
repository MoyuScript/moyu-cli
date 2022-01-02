/**
 * 配置
 */
const fs = require('fs')
const path = require('path')
const {Command} = require('commander')

const cmd = new Command('settings')

cmd.description('全局配置')

const settingPath = path.resolve(__dirname, '../../settings.json')

let settings = {};

if (!fs.existsSync(settingPath)) {
  fs.writeFileSync(settingPath, '{}')
} else {
  settings = JSON.parse(fs.readFileSync(settingPath, {encoding: 'utf-8'}))
}

function save() {
  fs.writeFileSync(settingPath, JSON.stringify(settings, undefined, 2))
}

exports.set = (key, value) => {
  settings[key] = value
  save()
}

exports.get = (key) => {
  return settings[key]
}

exports.remove = (key) => {
  if (settings[key]) {
    delete settings[key]
  }
}

cmd.command('set <key> <value>')
  .action((key, value) => {
    exports.set(key, value)
    console.log('成功设置', key, '为', value)
  })

cmd.command('get <key>')
  .action(key => {
    const value = exports.get(key)

    if (value === undefined) {
      console.log(key, '不存在')
    } else {
      console.log(`${key}=${JSON.stringify(value)}`)
    }
  })

cmd.command('remove <key>')
  .action(key => {
    const value = settings[key]

    if (value === undefined) {
      console.log(key, '不存在')
    } else {
      exports.remove(key)
      console.log('成功删除', key)
    }
  })

cmd.command('list')
  .action(() => {
    console.log(JSON.stringify(settings, undefined, 2))
  })


exports.command = cmd