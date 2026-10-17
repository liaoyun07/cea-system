FROM golang:1.24-alpine AS build
WORKDIR /src
COPY receiver.go receiver_test.go ./
RUN GOMAXPROCS=2 CGO_ENABLED=0 go test -v receiver.go receiver_test.go && GOMAXPROCS=2 CGO_ENABLED=0 go build -trimpath -o /receiver receiver.go
FROM scratch
COPY --from=build /receiver /receiver
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/receiver"]
