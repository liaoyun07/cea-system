/* One read pass per window. Anchored moments avoid large-offset cancellation.
 * SIMD only, no OpenMP worker threads, fast-math, input rewriting or extra bytes. */
#include <float.h>
#include <math.h>
#include <stddef.h>

int hydraulic_stats(const float *input, size_t windows, size_t width, double *output) {
    for (size_t w = 0; w < windows; ++w) {
        const float *row = input + w * width;
        const double anchor = row[0];
        double sum = 0.0, squares = 0.0, lower = DBL_MAX, upper = -DBL_MAX;
        int invalid = 0;
        #pragma omp simd reduction(+:sum,squares) reduction(min:lower) reduction(max:upper) reduction(|:invalid)
        for (size_t i = 0; i < width; ++i) {
            const double x = row[i], delta = x - anchor;
            sum += delta;
            squares += delta * delta;
            lower = x < lower ? x : lower;
            upper = x > upper ? x : upper;
            invalid |= !isfinite(x);
        }
        if (invalid) return 1;
        const double delta_mean = sum / width;
        const double mean = anchor + delta_mean;
        const double variance = fmax(0.0, squares / width - delta_mean * delta_mean);
        output[w * 5] = mean;
        output[w * 5 + 1] = sqrt(variance);
        output[w * 5 + 2] = lower;
        output[w * 5 + 3] = upper;
        output[w * 5 + 4] = sqrt(variance + mean * mean);
    }
    return 0;
}
