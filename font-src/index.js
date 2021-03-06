"use strict";

const fs = require("fs-extra");
const path = require("path");

const BuildFont = require("./gen/build-font.js");
const Parameters = require("./support/parameters");
const FormVariantData = require("./support/variant-data");
const FormLigationData = require("./support/ligation-data");
const { AnyCv, CvDecompose } = require("./support/gr");
const Toml = require("@iarna/toml");

module.exports = async function main(argv) {
	const para = await getParameters(argv);
	const font = BuildFont(para);
	if (argv.oCharMap) await saveCharMap(argv, font);
	if (argv.o) await saveOtd(argv, font);
};

// Parameter preparation
async function getParameters(argv) {
	const PARAMETERS_TOML = path.resolve(__dirname, "../params/parameters.toml");
	const WEIGHTS_TOML = path.resolve(__dirname, "../params/shape-weight.toml");
	const WIDTHS_TOML = path.resolve(__dirname, "../params/shape-width.toml");
	const PRIVATE_TOML = path.resolve(__dirname, "../params/private-parameters.toml");
	const VARIANTS_TOML = path.resolve(__dirname, "../params/variants.toml");
	const LIGATIONS_TOML = path.resolve(__dirname, "../params/ligation-set.toml");

	const parametersData = Object.assign(
		{},
		await tryParseToml(PARAMETERS_TOML),
		await tryParseToml(WEIGHTS_TOML),
		await tryParseToml(WIDTHS_TOML),
		(await fs.exists(PRIVATE_TOML)) ? await tryParseToml(PRIVATE_TOML) : {}
	);
	const rawVariantsData = await tryParseToml(VARIANTS_TOML);
	const rawLigationData = await tryParseToml(LIGATIONS_TOML);

	let para = {};
	Parameters.apply(para, parametersData, ["iosevka"]);
	Parameters.apply(para, parametersData, argv.preHives);
	Parameters.apply(para, parametersData, ["shapeWeight"], { shapeWeight: argv.shape.weight });
	Parameters.apply(para, parametersData, ["shapeWidth"], { shapeWidth: argv.shape.width });
	Parameters.apply(para, parametersData, [`s-${argv.shape.slope}`]);
	Parameters.apply(para, parametersData, [`diversity-${argv.shape.quasiProportionalDiversity}`]);

	const variantsData = FormVariantData(rawVariantsData, para);
	para.variants = variantsData;
	para.variantSelector = {};
	Parameters.apply(para.variantSelector, variantsData, ["default", ...argv.preHives]);
	para.defaultVariant = variantsData.default;

	const ligationData = FormLigationData(rawLigationData, para);
	para.defaultBuildup = { ...ligationData.defaultBuildup };
	para.ligation = {};
	Parameters.apply(para.ligation, ligationData.hives, ["default", ...argv.preHives]);

	if (argv.excludedCharRanges) para.excludedCharRanges = argv.excludedCharRanges;
	if (argv.compatibilityLigatures) para.compLig = argv.compatibilityLigatures;
	if (argv.metricOverride) Parameters.applyMetricOverride(para, argv.metricOverride);

	para.naming = {
		...para.naming,
		family: argv.menu.family,
		version: argv.menu.version,
		weight: argv.menu.weight - 0,
		width: argv.menu.width - 0,
		slope: argv.menu.slope
	};
	return para;
}

async function tryParseToml(str) {
	try {
		return Toml.parse(await fs.readFile(str, "utf-8"));
	} catch (e) {
		throw new Error(
			`Failed to parse configuration file ${str}.\nPlease validate whether there's syntax error.\n${e}`
		);
	}
}

// Save OTD
async function saveOtd(argv, font) {
	if (argv.o === "|") {
		process.stdout.write(JSON.stringify(font));
	} else {
		await fs.writeFile(argv.o, JSON.stringify(font, null, "    "));
	}
}

// Save char map
function objHashNonEmpty(obj) {
	if (!obj) return false;
	for (let k in obj) if (obj[k]) return true;
	return false;
}

async function saveCharMap(argv, font) {
	let charMap = [];
	for (const gid in font.glyf) {
		const glyph = font.glyf[gid];
		if (!glyph) continue;

		const glyphIsHidden = /^\./.test(gid);
		const typographicFeatures = [];
		if (!glyphIsHidden) {
			if (/\.NWID$/.test(gid) || /\.WWID$/.test(gid))
				typographicFeatures.push("NWID", "WWID");
			if (/\.lnum$/.test(gid) || /\.onum$/.test(gid))
				typographicFeatures.push("lnum", "onum");
		}

		let variantFeatures;
		if (CvDecompose.get(glyph)) {
			const variantFeatureSet = new Set();
			const decomposition = CvDecompose.get(glyph);
			for (const gn of decomposition) {
				const component = font.glyf[gn];
				if (!component) continue;
				for (const cv of AnyCv.query(component)) variantFeatureSet.add(cv.tag);
			}
			variantFeatures = Array.from(variantFeatureSet).sort();
		} else {
			variantFeatures = AnyCv.query(glyph)
				.map(gr => gr.tag)
				.sort();
		}

		charMap.push([glyph.name, glyph.unicode, typographicFeatures, variantFeatures]);
	}
	await fs.writeFile(argv.oCharMap, JSON.stringify(charMap), "utf8");
}
