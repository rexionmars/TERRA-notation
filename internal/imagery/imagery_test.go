package imagery

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The answer Esri gave at Humaitá, AM (-7.546178, -63.067186), trimmed to the
// fields asked for.
const humaita = `{"features":[
{"attributes":{"SRC_DATE":null,"SRC_RES":15,"SRC_ACC":12,"SRC_DESC":"TerraColor NextGen","NICE_NAME":"TerraColor NextGen","NICE_DESC":"Earthstar Geographics","MinMapLevel":0,"MaxMapLevel":11}},
{"attributes":{"SRC_DATE":20250414,"SRC_RES":0.31,"SRC_ACC":5,"SRC_DESC":"WV03","NICE_NAME":"Vivid","NICE_DESC":"Vantor","MinMapLevel":12,"MaxMapLevel":17}}]}`

func TestTheSourcesAtAPointComeFinestFirstWithTheirDates(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Query().Get("geometry")
		_, _ = w.Write([]byte(humaita))
	}))
	defer srv.Close()
	s, err := At(context.Background(), srv.Client(), srv.URL, -63.067186, -7.546178)
	if err != nil {
		t.Fatal(err)
	}
	if got != "-63.067186,-7.546178" {
		t.Fatalf("the point was sent as %q", got)
	}
	if len(s) != 2 || s[0].Date != "2025-04-14" || s[0].Sensor != "WV03" || s[0].ResolutionM != 0.31 ||
		s[0].MinLevel != 12 || s[0].MaxLevel != 17 || s[1].Date != "" || s[1].MaxLevel != 11 {
		t.Fatalf("sources = %+v", s)
	}
}

func TestAnErrorFromEsriIsReportedNotReadAsNoImagery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"error":{"code":400,"message":"Invalid query"}}`))
	}))
	defer srv.Close()
	if _, err := At(context.Background(), srv.Client(), srv.URL, 0, 0); err == nil {
		t.Fatal("an error answer was read as a list of sources")
	}
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer down.Close()
	if _, err := At(context.Background(), down.Client(), down.URL, 0, 0); err == nil {
		t.Fatal("a 502 was read as a list of sources")
	}
}

func TestADateThatIsNotOneIsLeftEmpty(t *testing.T) {
	for _, n := range []int64{0, 2025, 20251301, 20250400} {
		if d := date(&n); d != "" {
			t.Fatalf("%d was read as %s", n, d)
		}
	}
}
