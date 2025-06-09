import { Formatter, SimplifiedLinterResult } from './index.js';

/**
 * A container for the complete results of a linting operation. It holds the
 * raw linting data and provides efficient methods for interpreting it.
 */
export class Results {
  /**
   * An immutable array of simplified results for each commit that was linted.
   * Each item contains the commit hash and its corresponding lint outcome.
   */
  public readonly items: readonly SimplifiedLinterResult[];

  /**
   * The help URL to be used in formatted outputs, guiding users to fix errors.
   */
  public readonly helpUrl: string;

  /**
   * The total number of errors across all linted commits. This value is
   * pre-calculated in the constructor for O(1) access.
   */
  public readonly errorCount: number;

  /**
   * The total number of warnings across all linted commits. This value is
   * pre-calculated in the constructor for O(1) access.
   */
  public readonly warningCount: number;

  /**
   * Constructs a new Results instance. It eagerly processes the provided
   * linting results to generate and store aggregate counts for errors and
   * warnings, making subsequent checks highly efficient.
   *
   * @param items An array of simplified results for each linted commit.
   * @param helpUrl A URL for help and documentation to be used in formatting.
   */
  constructor(items: readonly SimplifiedLinterResult[], helpUrl: string) {
    this.items = items;
    this.helpUrl = helpUrl;

    const { errorCount, warningCount } = items.reduce(
      (counts, item) => ({
        errorCount: counts.errorCount + item.errors.length,
        warningCount: counts.warningCount + item.warnings.length,
      }),
      { errorCount: 0, warningCount: 0 },
    );

    this.errorCount = errorCount;
    this.warningCount = warningCount;
  }

  /**
   * Gets the total number of commits that were analyzed by the linter.
   *
   * @returns The count of commits that were linted.
   */
  get checkedCount(): number {
    return this.items.length;
  }

  /**
   * Checks if any of the linted commits contain at least one error. This
   * getter relies on the pre-calculated error count for O(1) efficiency.
   *
   * @returns `true` if there are one or more errors, otherwise `false`.
   */
  get hasErrors(): boolean {
    return this.errorCount > 0;
  }

  /**
   * Checks if the results contain only warnings. This means no errors exist,
   * but at least one warning is present across all commits.
   *
   * @returns `true` if there are warnings but no errors, otherwise `false`.
   */
  get hasOnlyWarnings(): boolean {
    return this.errorCount === 0 && this.warningCount > 0;
  }

  /**
   * Formats and outputs the results using a provided formatter object. This
   * method delegates the rendering logic, allowing for different output
   * strategies (e.g., to the console or a GitHub Actions Summary).
   *
   * @param formatter An object that implements the `Formatter` interface and
   * is responsible for rendering the results.
   */
  public async format(formatter: Formatter): Promise<void> {
    formatter.format(this);
  }
}
