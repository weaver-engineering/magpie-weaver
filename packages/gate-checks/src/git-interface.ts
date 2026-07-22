/**
 * A shallow interface to the git command line for the access required
 * to validate commits conforming to the ways of working.
 *
 * Required to mock git access in unit tests.
 */
export interface GitInspector {
  /**
   * Get the reference (Sha) of the commit where the 2 references diverge.
   *
   * @param aRef The reference to a commit
   * @param bRef The reference to another commit
   * @returns The commit reference where the changes to aRef diverge from the changes to bRef
   */
  mergeBase(aRef: string, bRef: string): Promise<string>;

  /**
   * List the file changes between baseRef and headRef.
   * If headRef is not given then list the file changes in baseRef.
   *
   * @param baseRef The starting reference
   * @param headRef The ending reference
   * @returns A list of the changed paths in the repository between baseRef and headRef
   */
  diffTree(baseRef: string, headRef?: string): Promise<string[]>;

  /**
   * List the paths in the repository at the given commit reference.
   * If the path is not given list all the paths in the repository.
   *
   * @param commitRef List the paths in the repository up to this reference
   * @param path If given only list the paths with this prefix
   * @returns A list of the paths in the repository to the given reference
   */
  lsTree(commitRef: string, path?: string): Promise<string[]>;

  /**
   * List the commit messages from baseRef to headRef.
   * If headRef is not given then return the commit message for the baseRef.
   *
   * @param baseRef The reference of the first commit message
   * @param headRef The reference of the last commit message
   * @returns The commit messages between baseRef and headRef
   */
  commitMessages(baseRef: string, headRef?: string): Promise<string[]>;

  /**
   * List the files added between baseRef and headRef.
   * If headRef is not given list the files added by baseRef.
   * If the path is given only list the files added with that prefix.
   *
   * @param baseRef The starting reference
   * @param path The path prefix
   * @param headRef The ending reference
   * @returns The files added to the repository between baseRef and headRef
   */
  added(baseRef: string, path?: string, headRef?: string): Promise<string[]>;

  /**
   * List the files modified between baseRef and headRef.
   * If headRef is not given list the files modified by baseRef.
   * If the path is given only list the files modified with that prefix.
   *
   * @param baseRef The starting reference
   * @param path The path prefix
   * @param headRef The ending reference
   * @returns The files modified in the repository between baseRef and headRef
   */
  modified(baseRef: string, path?: string, headRef?: string): Promise<string[]>;

  /**
   * List the files deleted between baseRef and headRef.
   * If headRef is not given list the files deleted by baseRef.
   * If the path is given only list the files deleted with that prefix.
   *
   * @param baseRef The starting reference
   * @param path The path prefix
   * @param headRef The ending reference
   * @returns The files deleted in the repository between baseRef and headRef
   */
  deleted(baseRef: string, path?: string, headRef?: string): Promise<string[]>;

  /**
   * List the commits from baseRef to headRef.
   *
   * @param baseRef The starting reference
   * @param headRef The ending reference
   * @returns The commit references between baseRef and headRef
   */
  revList(baseRef: string, headRef: string): Promise<string[]>;
}
