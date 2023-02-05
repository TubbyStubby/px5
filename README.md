# About
Express patcher to add extra route info to request object - `req`. Can be used for group metrics for endpoints etc.

## How it works
This patches application and Router's use, get, put, post, delete and patch methods to do the following things -
- Whenever any handler passed to those functions is called, the path it was mounted on is added to a stack.
- If the handler has `next` method then the path is popped from the stack.
- If handler is errorware then stack is not updated.
- Once `res.send` is invoked then stack is frozen and is not updated any further.

Final the state of the stack represents the route the request took.

## Usage

```js
import px5 from "px5";

//patch before importing express
px5.patch();

import express from "express";
...
```

once patch is applied successfully following operations can be performed -

1. Get path taken by request so far

```js
px5.getNormalizedPath(req); // returns - /api/order/:type
```

2. If you want to manually freeze the stack it can be done like this

```js
px5.freezeStack(req);
```

3. Check if stack is frozen or not

```js
px5.isStackFrozen(req);
```

## Want to contribute?
Make your changes, add a changeset using `npx changeset` and create a pr.

## Todo
- Add tests
- Add methods to make it apply custom patches
- Improve typing
