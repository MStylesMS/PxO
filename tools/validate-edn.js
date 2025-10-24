const fs = require('fs');
const path = require('path');

function validateEdnFile(filePath) {
  try {
    console.log(`Validating EDN file: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ednContent = fs.readFileSync(filePath, 'utf8');
    console.log('File read successfully');

    // Basic content validation
    if (!ednContent.includes(':global')) {
      throw new Error('Missing :global section');
    }

    if (!ednContent.includes(':game-modes')) {
      throw new Error('Missing :game-modes section');
    }

    if (!ednContent.includes(':version')) {
      throw new Error('Missing version information');
    }

    console.log('EDN structure validation passed');

    // Extract basic info using regex
    const versionMatch = ednContent.match(/:version\s+"([^"]+)"/);
    if (versionMatch) {
      console.log(`Version: ${versionMatch[1]}`);
    }

    const gamesSection = ednContent.split(':game-modes')[1];
    if (gamesSection) {
      const gameMatches = gamesSection.match(/:hc-\w+/g);
      if (gameMatches) {
        console.log(`Number of game modes: ${gameMatches.length}`);
      }
    }

    return true;
  } catch (error) {
    console.error('EDN validation failed:', error.message);
    return false;
  }
}

// Main execution
if (require.main === module) {
  const ednFile = path.join(__dirname, '..', 'config', 'houdini.edn');
  const success = validateEdnFile(ednFile);
  process.exit(success ? 0 : 1);
}

module.exports = { validateEdnFile };
