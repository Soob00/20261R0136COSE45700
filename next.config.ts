import { resolve } from "path";
import type { NextConfig } from "next";

const projectRoot = resolve(__dirname);

const nextConfig = {
	outputFileTracingRoot: projectRoot,
	turbopack: {
		root: projectRoot,
	},
} as NextConfig;

export default nextConfig;
