# StitchFlow submission documents

This pack contains the project Technical Design Document, its PDF rendering, the deployment guide, and a PowerShell helper for building the source ZIP on the development machine.

## Contents

- `TDD.docx` - editable Technical Design Document (9 pages).
- `TDD.pdf` - read-only PDF version.
- `deployment.md` - deployment and operations instructions.
- `package-submission.ps1` - creates the final source ZIP from the local repository while excluding secrets and runtime folders.

## Create the full source submission ZIP

1. Copy `TDD.docx`, `TDD.pdf`, and `deployment.md` into a `docs` folder at the root of the local StitchFlow repository.
2. Copy `package-submission.ps1` into that same `docs` folder.
3. Open PowerShell and run the script from the repository's `docs` folder:

   ```powershell
   cd D:\StitchFlow\stitchflow\docs
   .\package-submission.ps1
   ```

4. The script creates a timestamped `StitchFlow-submission-*.zip` one directory above the repository (normally `D:\StitchFlow`). It excludes `.git`, `node_modules`, Vite `dist`, server `uploads`, generated Prisma Client output, and real `.env` files.
5. Inspect the retained temporary staging directory and the ZIP contents before uploading. Ensure the ZIP is below the 25 MB limit and contains no credentials or private photo files.

The source repository itself is not embedded in this documents-only pack. The PowerShell helper builds the full source ZIP locally from the actual repository.

## Review before submission

The TDD records implementation and deployment details verified through 8 November 2026. Review any changes made after that date, and keep all credentials out of GitHub and the ZIP.
