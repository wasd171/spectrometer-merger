const fs = require('fs')
const path = require('path')
const util = require('util')
const os = require('os')
const _ = require('lodash')
const program = require('commander')
const json = require('./package.json')
const minimize = require('minimize-golden-section-1d')

const readdir = util.promisify(fs.readdir)
const readFile = util.promisify((filename, callback) =>
	fs.readFile(filename, 'utf-8', callback)
)
const writeFile = util.promisify(fs.writeFile)

async function processData(LAMP_MODE) {
	const OVERLAP_COUNT = 104
	const DIRECTORY = 'data'
	const BUILD_DIRECTORY = 'dist'

	let regexp
	if (LAMP_MODE) {
		regexp = /(lamp)_(\d*)nm_100ms_100acc_ppol_Forward_1loop_1500mA_0\.txt/
	} else {
		regexp = /ris(\d*)_(\d*)nm_100ms_100acc_ppol_Forward_1loop_1500mA_0\.txt/
	}

	const data = new Map()

	const files = await readdir(DIRECTORY)

	const neededFiles = files.filter(filename => regexp.test(filename))
	await Promise.all(
		neededFiles.map(async filename => {
			const file = await readFile(
				path.resolve(__dirname, DIRECTORY, filename)
			)

			const array = file
				.split(os.EOL)
				.map(str => parseInt(str, 10))
				.filter(value => !_.isNaN(value))

			let [, ris, wavelength] = regexp.exec(filename)
			if (!LAMP_MODE) {
				;[ris, wavelength] = [ris, wavelength].map(str =>
					parseInt(str, 10)
				)
			} else {
				wavelength = parseInt(wavelength, 10)
			}

			if (!data.has(ris)) {
				data.set(ris, new Map())
			}
			data.get(ris).set(wavelength, array)
		})
	)

	await Promise.all(
		[...data.entries()].map(async ([ris, map]) => {
			let rawData = [...map.keys()].sort().map(key => map.get(key))

			let formattedData = rawData.reduce((accumulator, array) => {
				if (accumulator.length === 0) {
					accumulator.push(...array)
				} else {
					const previous = _.takeRight(accumulator, OVERLAP_COUNT)
					const current = _.take(array, OVERLAP_COUNT)

					let distance = 0
					for (let i = 0; i < OVERLAP_COUNT; i++) {
						distance += previous[i] - current[i]
					}
					distance = distance / OVERLAP_COUNT

					const formatted = array.map(value => value + distance)
					accumulator.push(...formatted)
				}

				return accumulator
			}, [])

			rawData = [].concat(...rawData)

			function squares(distance) {
				let sum = 0
				for (let i = 0; i < rawData.length; i++) {
					const diff = formattedData[i] + distance - rawData[i]
					sum += diff * diff
				}
				return sum
			}

			const distance = minimize(squares)
			formattedData = formattedData.map(value => value + distance)

			const formattedFile = formattedData.join(os.EOL)

			if (!fs.existsSync(BUILD_DIRECTORY)) {
				fs.mkdirSync(BUILD_DIRECTORY)
			}

			await writeFile(
				path.join(BUILD_DIRECTORY, `${ris}.txt`),
				formattedFile
			)
		})
	)
}

async function main() {
	program
		.version(json.version)
		.option(
			'-m --mode <mode>',
			'Working mode. Allowed values: lamp, ris, all. Default: all',
			'all'
		)
		.parse(process.argv)

	if (program.mode === 'all') {
		await processData(false)
		await processData(true)
	} else {
		if (program.mode === 'ris') {
			await processData(false)
		}
		if (program.mode === 'lamp') {
			await processData(true)
		}
	}
}

main()
