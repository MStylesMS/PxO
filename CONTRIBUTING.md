# Contributing to Paradox Orchestrator (PxO)

## Repository Setup

PxO uses a dual-repository strategy:

- **Primary (GitHub)**: https://github.com/MStylesMS/PxO
- **Mirror (GitLab)**: https://gitlab.gnurdle.com/paradox/pxo

All development happens on GitHub (for GitHub Copilot integration), and changes are automatically mirrored to GitLab.

## Git Configuration

The local repository is configured to push to both remotes simultaneously:

```bash
git remote -v
# origin  git@github.com:MStylesMS/PxO.git (fetch)
# origin  git@github.com:MStylesMS/PxO.git (push)
# origin  git@gitlab.gnurdle.com:paradox/pxo.git (push)
# gitlab  git@gitlab.gnurdle.com:paradox/pxo.git (fetch)
# gitlab  git@gitlab.gnurdle.com:paradox/pxo.git (push)
```

When you `git push origin main`, the commit goes to both GitHub and GitLab automatically.

## Development Workflow

1. **Create feature branch**: `git checkout -b feature/your-feature`
2. **Make changes**: Edit code, add tests, update docs
3. **Test locally**: 
   ```bash
   npm test
   npm run validate
   ```
4. **Commit changes**: `git commit -m "feat: your feature description"`
5. **Push to GitHub**: `git push origin feature/your-feature`
6. **Create Pull Request** on GitHub
7. **After merge**: Both GitHub and GitLab main branches sync automatically

## Coding Standards

### Code Style

- **Indentation**: 2 spaces
- **Semicolons**: Optional but consistent within files
- **Quotes**: Single quotes for strings
- **Line length**: ~100 characters (soft limit)

### Naming Conventions

- **Files**: kebab-case (`sequence-runner.js`, `config-validator.js`)
- **Variables/Functions**: camelCase (`executeSequence`, `validateConfig`)
- **Classes**: PascalCase (`SequenceRunner`, `MqttClient`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_TIMEOUT`, `MAX_RETRIES`)

### Documentation

- Add JSDoc comments for public functions
- Include usage examples in docstrings
- Update README.md for new features
- Document breaking changes in commit messages

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring (no functional change)
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, build config)
- `perf`: Performance improvements

**Examples:**
```
feat(hints): add video hint support with duration parameter

Implements video hints with configurable duration and autoplay settings.
Closes #42

fix(mqtt): handle connection loss gracefully

Adds reconnection logic with exponential backoff.
Fixes #58
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:contract
npm run test:scheduler
npm run test:e2e

# Run with debug logging
LOG_LEVEL=debug npm test
```

### Writing Tests

- Place tests in `/test` directory
- Use descriptive test names: `test('should execute sequence in order', ...)`
- Test both success and failure cases
- Mock external dependencies (MQTT, file system)

## Pull Request Guidelines

1. **One feature per PR**: Keep changes focused
2. **Update tests**: Add tests for new functionality
3. **Update docs**: Document new features/changes
4. **Clean commit history**: Squash WIP commits before submitting
5. **Link issues**: Reference issue numbers in PR description
6. **Request review**: Tag maintainers for review

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md with release notes
3. Commit: `chore: release v1.x.x`
4. Tag: `git tag -a v1.x.x -m "Release v1.x.x"`
5. Push: `git push origin main --tags` (pushes to both GitHub and GitLab)
6. Create GitHub release with changelog

## Questions or Issues?

- **GitHub Issues**: https://github.com/MStylesMS/PxO/issues
- **Email**: mark@paradoxrooms.com
- **Documentation**: See `/docs` directory

## License

By contributing to PxO, you agree that your contributions will be licensed under the MIT License.
