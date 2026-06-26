/** Express 5 types params as string | string[]; our routes always use single segment IDs. */
declare global {
  namespace Express {
    interface ParamsDictionary {
      [key: string]: string
    }
  }
}

export {}
