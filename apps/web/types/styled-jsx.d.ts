import "react";

// styled-jsx (bundled and compiled by Next.js) adds the boolean `jsx` and
// `global` attributes to <style> elements, but does not contribute their
// ambient prop types in this project's setup. Declare them so TSX using
// `<style jsx global>` type-checks under `next build`.
declare module "react" {
  interface StyleHTMLAttributes<T> {
    jsx?: boolean;
    global?: boolean;
  }
}
