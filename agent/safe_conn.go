package main

import (
	"sync"

	"github.com/gorilla/websocket"
)

// safeConn wraps a websocket.Conn with a mutex to prevent concurrent writes.
// gorilla/websocket does not support concurrent writers.
type safeConn struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func newSafeConn(conn *websocket.Conn) *safeConn {
	return &safeConn{conn: conn}
}

func (c *safeConn) writeJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(v)
}

func (c *safeConn) readJSON(v interface{}) error {
	return c.conn.ReadJSON(v)
}

func (c *safeConn) close() error {
	return c.conn.Close()
}
