/**
 * Log Cleanup Utility
 * 
 * Handles automatic cleanup of old log files based on age and size limits
 */

const fs = require('fs');
const path = require('path');

class LogCleanup {
    /**
     * Clean up old log files in a directory
     * @param {string} logDir - Directory containing log files
     * @param {Object} options - Cleanup options
     * @param {number} options.maxAgeDays - Maximum age in days (default: 30)
     * @param {number} options.maxSizeMB - Maximum total size in MB (default: 100)
     * @param {string} options.pattern - File pattern to match (default: '*.log')
     * @param {Array<string>} options.excludeFiles - Files to exclude (e.g., 'pfx-latest.log')
     */
    static async cleanup(logDir, options = {}) {
        const {
            maxAgeDays = 30,
            maxSizeMB = 100,
            pattern = /\.log$/,
            excludeFiles = []
        } = options;

        try {
            if (!fs.existsSync(logDir)) {
                return { deleted: 0, kept: 0, totalSize: 0 };
            }

            const files = fs.readdirSync(logDir);
            const logFiles = [];
            const now = Date.now();
            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
            const maxSizeBytes = maxSizeMB * 1024 * 1024;

            // Gather info about all log files
            for (const file of files) {
                const filePath = path.join(logDir, file);
                
                // Skip excluded files (like symlinks) and non-log files
                if (excludeFiles.includes(file)) continue;
                if (!pattern.test(file)) continue;

                try {
                    const stat = fs.statSync(filePath);
                    
                    // Skip directories and symlinks
                    if (!stat.isFile()) continue;

                    logFiles.push({
                        name: file,
                        path: filePath,
                        mtime: stat.mtime.getTime(),
                        size: stat.size,
                        age: now - stat.mtime.getTime()
                    });
                } catch (err) {
                    // Skip files we can't stat
                    continue;
                }
            }

            // Sort by age (oldest first)
            logFiles.sort((a, b) => b.mtime - a.mtime);

            let totalSize = logFiles.reduce((sum, f) => sum + f.size, 0);
            let deleted = 0;
            const toDelete = [];

            // Delete files older than maxAgeDays
            for (const file of logFiles) {
                if (file.age > maxAgeMs) {
                    toDelete.push(file);
                }
            }

            // If still over size limit, delete oldest files
            if (totalSize > maxSizeBytes) {
                const sortedByAge = [...logFiles].sort((a, b) => a.mtime - b.mtime);
                for (const file of sortedByAge) {
                    if (totalSize <= maxSizeBytes) break;
                    if (!toDelete.includes(file)) {
                        toDelete.push(file);
                        totalSize -= file.size;
                    }
                }
            }

            // Delete the files
            for (const file of toDelete) {
                try {
                    fs.unlinkSync(file.path);
                    deleted++;
                } catch (err) {
                    // Skip files we can't delete
                }
            }

            return {
                deleted,
                kept: logFiles.length - deleted,
                totalSize: Math.round(totalSize / 1024 / 1024 * 100) / 100 // MB
            };

        } catch (err) {
            // Return error info but don't throw
            return {
                error: err.message,
                deleted: 0,
                kept: 0,
                totalSize: 0
            };
        }
    }
}

module.exports = LogCleanup;
