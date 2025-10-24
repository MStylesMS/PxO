#!/usr/bin/env node

/**
 * Naming Convention Validator
 * Checks the codebase for naming convention violations
 * 
 * Usage:
 *   node tools/validate-naming-conventions.js
 *   node tools/validate-naming-conventions.js --fix
 */

const fs = require('fs');
const path = require('path');

class NamingValidator {
    constructor(options = {}) {
        this.fix = options.fix || false;
        this.errors = [];
        this.warnings = [];

        // Patterns to detect naming violations
        this.patterns = {
            // JavaScript runtime fallback chains (should be eliminated)
            fallbackChains: /\w+\s*\|\|\s*\w+\[.*['"]\s*[-_]\s*.*['"]\s*\]/g,

            // kebab-case in JavaScript runtime (should be camelCase)
            kebabInJS: /\.\s*['"][a-z]+-[a-z-]*['"]\s*(?=\]|:|\s*=)/g,

            // underscore_case in configuration access (should be camelCase)
            underscoreInJS: /\.\s*\w*_\w*\s*(?=\s*[;,\)\]\}])/g,

            // Multiple key variants in same file
            multipleVariants: {
                heartbeat: /(gameHeartbeat|game_heartbeat|game-heartbeat)/g,
                baseTopic: /(baseTopic|base_topic|base-topic)/g,
                defaultMode: /(defaultMode|default_mode|default-mode)/g
            }
        };

        this.directories = [
            'game/src',
            'tools',
            'test'
        ];
    }

    async validate() {
        console.log('🔍 Validating naming conventions...\n');

        for (const dir of this.directories) {
            if (fs.existsSync(dir)) {
                await this.validateDirectory(dir);
            }
        }

        this.reportResults();
        return this.errors.length === 0;
    }

    async validateDirectory(dirPath) {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                await this.validateDirectory(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                await this.validateFile(fullPath);
            }
        }
    }

    async validateFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');

            this.checkFallbackChains(filePath, content, lines);
            this.checkKebabCaseInJS(filePath, content, lines);
            this.checkUnderscoreCase(filePath, content, lines);
            this.checkMultipleVariants(filePath, content, lines);

        } catch (error) {
            this.warnings.push(`⚠️  Could not read file: ${filePath} (${error.message})`);
        }
    }

    checkFallbackChains(filePath, content, lines) {
        const matches = [...content.matchAll(this.patterns.fallbackChains)];

        for (const match of matches) {
            const lineNum = this.getLineNumber(content, match.index);
            this.errors.push({
                type: 'fallback-chain',
                file: filePath,
                line: lineNum,
                text: lines[lineNum - 1].trim(),
                message: 'Configuration fallback chain detected (should use canonical camelCase form only)',
                match: match[0]
            });
        }
    }

    checkKebabCaseInJS(filePath, content, lines) {
        // Skip EDN files and config files
        if (filePath.includes('.edn') || filePath.includes('config/')) return;

        const matches = [...content.matchAll(this.patterns.kebabInJS)];

        for (const match of matches) {
            const lineNum = this.getLineNumber(content, match.index);
            this.warnings.push({
                type: 'kebab-in-js',
                file: filePath,
                line: lineNum,
                text: lines[lineNum - 1].trim(),
                message: 'kebab-case property access in JavaScript (consider using camelCase)',
                match: match[0]
            });
        }
    }

    checkUnderscoreCase(filePath, content, lines) {
        // Skip if file contains known legacy underscore patterns that are acceptable
        if (content.includes('base_topic') && filePath.includes('legacy')) return;

        const matches = [...content.matchAll(this.patterns.underscoreInJS)];

        for (const match of matches) {
            const lineNum = this.getLineNumber(content, match.index);
            this.warnings.push({
                type: 'underscore-in-js',
                file: filePath,
                line: lineNum,
                text: lines[lineNum - 1].trim(),
                message: 'underscore_case property access (should use camelCase)',
                match: match[0]
            });
        }
    }

    checkMultipleVariants(filePath, content, lines) {
        for (const [concept, pattern] of Object.entries(this.patterns.multipleVariants)) {
            const matches = [...content.matchAll(pattern)];
            const variants = new Set(matches.map(m => m[1]));

            if (variants.size > 1) {
                const lineNum = this.getLineNumber(content, matches[0].index);
                this.errors.push({
                    type: 'multiple-variants',
                    file: filePath,
                    line: lineNum,
                    text: lines[lineNum - 1].trim(),
                    message: `Multiple naming variants for '${concept}' in same file: ${Array.from(variants).join(', ')}`,
                    variants: Array.from(variants)
                });
            }
        }
    }

    getLineNumber(content, index) {
        return content.substring(0, index).split('\n').length;
    }

    reportResults() {
        console.log('📊 VALIDATION RESULTS');
        console.log('='.repeat(50));

        if (this.errors.length === 0 && this.warnings.length === 0) {
            console.log('✅ No naming convention violations found!\n');
            return;
        }

        if (this.errors.length > 0) {
            console.log(`❌ ERRORS (${this.errors.length}):`);
            console.log('-'.repeat(30));

            for (const error of this.errors) {
                console.log(`📁 ${error.file}:${error.line}`);
                console.log(`   ${error.message}`);
                console.log(`   Code: ${error.text}`);
                if (error.match) console.log(`   Match: "${error.match}"`);
                console.log('');
            }
        }

        if (this.warnings.length > 0) {
            console.log(`⚠️  WARNINGS (${this.warnings.length}):`);
            console.log('-'.repeat(30));

            for (const warning of this.warnings) {
                console.log(`📁 ${warning.file}:${warning.line}`);
                console.log(`   ${warning.message}`);
                console.log(`   Code: ${warning.text}`);
                console.log('');
            }
        }

        console.log('💡 RECOMMENDATIONS:');
        console.log('-'.repeat(30));
        console.log('• Use camelCase for all JavaScript runtime configuration access');
        console.log('• Use kebab-case for EDN configuration keys and MQTT topics');
        console.log('• Eliminate fallback chains (||) for configuration keys');
        console.log('• Stick to canonical forms defined in docs/NAMING_CONVENTIONS.md');
        console.log('');

        if (this.errors.length > 0) {
            console.log(`❌ Validation failed with ${this.errors.length} error(s).`);
            process.exit(1);
        } else {
            console.log(`✅ Validation passed with ${this.warnings.length} warning(s).`);
        }
    }
}

// CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {
        fix: args.includes('--fix')
    };

    const validator = new NamingValidator(options);
    validator.validate().catch(error => {
        console.error('Validation failed:', error);
        process.exit(1);
    });
}

module.exports = NamingValidator;
