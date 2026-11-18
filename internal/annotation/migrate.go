package annotation

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
)

/*
migrations take the project database from one version to the next:
migrations[0] from 1 to 2, migrations[1] from 2 to 3, and so on. A migration
only adds tables, columns and triggers. It never rewrites a row of
annotation_history, whose triggers stay in force while it runs.
*/
var migrations = []string{
	// 2: the date of the imagery the reference screenshot shows, and the
	// moment the record was opened before each save.
	`ALTER TABLE annotation ADD COLUMN reference_date TEXT NOT NULL DEFAULT '';
ALTER TABLE annotation_history ADD COLUMN reference_date TEXT NOT NULL DEFAULT '';
ALTER TABLE annotation_history ADD COLUMN opened_at TEXT;`,
}

// schemaVersion is the version this build of the application writes.
var schemaVersion = len(migrations) + 1

// migrateTx applies, inside tx, every migration after version from.
func migrateTx(tx *sql.Tx, from int) error {
	for v := from; v < schemaVersion; v++ {
		if _, err := tx.Exec(migrations[v-1]); err != nil {
			return fmt.Errorf("upgrade the project database to version %d: %w", v+1, err)
		}
	}
	if _, err := tx.Exec(`UPDATE project SET value = ? WHERE key = 'schema_version'`,
		strconv.Itoa(schemaVersion)); err != nil {
		return fmt.Errorf("upgrade the project database: %w", err)
	}
	return nil
}

/*
migrate brings an opened project written at version v up to schemaVersion.
Before the first change it copies the database to
annotations.schema-<v>.sqlite beside it, so the project as an earlier build
left it can still be read by that build. A project from a later build is
refused rather than read with columns this build does not know.
*/
func (p *Project) migrate(v string) error {
	from, err := strconv.Atoi(v)
	if err != nil || from < 1 {
		return fmt.Errorf("the project's schema version %q is not one this application wrote", v)
	}
	if from > schemaVersion {
		return fmt.Errorf("the project was written with schema version %d by a newer version of the application; this one reads up to %d", from, schemaVersion)
	}
	if from == schemaVersion {
		return nil
	}
	if err := copyNew(filepath.Join(p.dir, DBFile),
		filepath.Join(p.dir, fmt.Sprintf("annotations.schema-%d.sqlite", from))); err != nil {
		return fmt.Errorf("keep a copy of the project database before upgrading it: %w", err)
	}
	tx, err := p.db.Begin()
	if err != nil {
		return fmt.Errorf("upgrade the project database: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := migrateTx(tx, from); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("upgrade the project database: %w", err)
	}
	return nil
}

// copyNew copies src to dst, which must not exist; an existing dst, a copy
// an earlier attempt made, is kept as it is.
func copyNew(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, fs.ErrExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		_ = os.Remove(dst)
		return err
	}
	return out.Close()
}
